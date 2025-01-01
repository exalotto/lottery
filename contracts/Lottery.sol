// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@chainlink/contracts/src/v0.8/vrf/interfaces/VRFCoordinatorV2Interface.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import "./Drawing.sol";
import "./TicketIndex.sol";
import "./UserTickets.sol";

/// @dev ERC-20 token used for payments and prizes. Currently set to Dai on Polygon PoS.
IERC20 constant CURRENCY_TOKEN = IERC20(0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063);

/// @dev Since we use Dai, this is set to $1.50.
uint constant INITIAL_TICKET_PRICE = 150e-2 ether;

/// @dev The ChainLink VRF will wait for this number of block confirmations before invoking our
///   callback with the randomness.
uint16 constant VRF_REQUEST_CONFIRMATIONS = 10;

/// @dev ChainLink VRF callback gas limit.
uint32 constant VRF_CALLBACK_GAS_LIMIT = 1000000;

contract Lottery is
  Initializable,
  UUPSUpgradeable,
  OwnableUpgradeable,
  PausableUpgradeable,
  ReentrancyGuardUpgradeable
{
  using TicketIndex for mapping(uint256 => uint);
  using UserTickets for TicketData[];

  struct RoundData {
    /// @dev Price of a 6-number ticket for the round, in wei.
    uint256 baseTicketPrice;
    /// @dev Indexes tickets by played numbers. This data structure is used with the `TicketIndex`
    ///   library. See the note on that library for more information on how it works.
    mapping(uint256 => uint) ticketIndex;
    /// @dev Prizes for each winning category. `prizes[0]` is the prize for the 2-match category,
    ///   `prizes[1]` for the 3-match category, etc., and `prizes[4]` is the jackpot. Each entry is
    ///   the whole sum allocated for a category, so that each winner in that category will be able
    ///   to withdraw that sum divided by the number of winners in the category.
    uint256[5] prizes;
    /// @dev This stash accumulates 6% of the ticket sales and is used to fund the next round in
    ///   case one or more tickets match all 6 numbers. This way the jackpot is never zero.
    uint256 stash;
    /// @dev Total number of 6-combinations played in the round. Tickets with 6 numbers add 1
    ///   combination to this count, tickets with 7 numbers add 7, tickets with 8 add 28, and so on.
    uint totalCombinations;
    /// @dev Keeps track of the number of 6-combinations sold with each referral code. Partners can
    ///   then withdraw a corresponding share of the revenue.
    mapping(bytes32 => uint) combinationsByReferralCode;
    /// @dev Block number of the transaction that called the `draw` method.
    uint256 drawBlockNumber;
    /// @dev VRF request ID, returned by the VRF coordinator invocation. For security reasons, the
    ///   callback checks the received request ID against this value and reverts if they differ.
    uint256 vrfRequestId;
    /// @dev The 6 drawn numbers.
    uint8[6] numbers;
    /// @dev Block number of the transaction that closed the round. This transaction is triggered by
    ///   the ChainLink VRF.
    uint256 closureBlockNumber;
    /// @dev How many winning 6-combinations in each category. `winners[0]` is the number of
    ///   2-matches, `winners[1]` is for 3-matches, etc. `totalCombinations` is the sum of these 5
    ///   numbers. Note that each winning ticket of category i can withdraw a prize of
    ///   `prizes[i] / winners[i]`.
    uint[5] winners;
  }

  event NewRound(uint indexed round, uint256 baseTicketPrice, uint256[5] prizes, uint256 stash);

  event NewBaseTicketPrice(uint256 newPrice);

  event ClaimReferralCode(bytes32 indexed code, address indexed partner);

  event Ticket(
    uint indexed round,
    address indexed player,
    uint indexed id,
    uint8[] numbers,
    bytes32 referralCode
  );

  event Ticket6(
    uint indexed round,
    address indexed player,
    uint indexed id,
    uint8[6] numbers,
    bytes32 referralCode
  );

  event VRFRequest(uint indexed round, uint256 subscriptionId, uint256 requestId);

  event Draw(
    uint indexed round,
    uint totalCombinations,
    uint8[6] numbers,
    uint[5] winners,
    uint256[5] prizes
  );

  event PrizeWithdrawal(uint indexed ticketId, address indexed account, uint256 amount);

  error ReferralCodeAlreadyExistsError(bytes32 referralCode);
  error SalesAreClosedError();
  error InvalidNumbersError(uint8[] numbers);
  error InvalidReferralCodeError(bytes32 referralCode);
  error InvalidRoundNumberError(uint round);
  error InvalidStateError();
  error OnlyCoordinatorCanFulfill(address got, address want);
  error VRFRequestError(uint256 requestId, uint256 expectedRequestId);
  error NoPrizeError(uint ticketId);
  error PrizeAlreadyWithdrawnError(uint ticketId);

  /// @notice ChainLink VRF coordinator.
  VRFCoordinatorV2Interface public vrfCoordinator;

  /// @dev Price of a 6-number ticket in wei. This is not actually taken into account when a user
  ///   buys a ticket. The price of a ticket is calculated using the `baseTicketPrice` field of the
  ///   current round (see `RoundData`). That field is in turn initialized to the value of
  ///   `_baseTicketPrice` when the round is created, so this field provides an upgradeability
  ///   mechanism that allows refining ticket prices in-between rounds. Upgrading them inside an
  ///   ongoing round would be unfair, so we don't allow it.
  uint256 public _baseTicketPrice;

  /// @dev Associates each user account with the list of tickets that user created. The `TicketData`
  ///   objects in each array are ordered by ticket ID in ascending order. This is a consequence of
  ///   the fact that the ID is incremental.
  mapping(address => TicketData[]) private _ticketsByPlayer;

  /// @notice Indices are ticket IDs, values are player addresses. The first element is unused
  ///   because ticket ID 0 is considered invalid.
  address[] public playersByTicket;

  /// @dev Stores per-round data. The last element of this array represents the current round,
  ///   therefore the information it contains is incomplete most of the time. See the `RoundData`
  ///   struct for more details.
  RoundData[] private _rounds;

  /// @dev True indicates that the ticket sales are open. False indicates that a drawing is in
  ///   progress (the lottery is waiting for the ChainLink VRF to return the random numbers). This
  ///   is open most of the time.
  bool private _open;

  /// @dev Start time of the next allowed drawing window.
  uint private _nextDrawTime;

  /// @notice Associates referral codes to partner accounts.
  mapping(bytes32 => address) public partnersByReferralCode;

  /// @notice Associates partner accounts to the list of their respective referral codes.
  mapping(address => bytes32[]) public referralCodesByPartner;

  /// @dev Number of the last round for which the fees associated to each referral code have been
  ///   withdrawn. Note that round 0 is invalid and each entry of this map is initially 0, so the
  ///   initial state is that no fees have been withdrawn for any referral code.
  mapping(bytes32 => uint) private _lastWithdrawRoundByReferralCode;

  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() {
    _disableInitializers();
  }

  function __Lottery_init_unchained(address _vrfCoordinator) private onlyInitializing {
    vrfCoordinator = VRFCoordinatorV2Interface(_vrfCoordinator);
    _baseTicketPrice = INITIAL_TICKET_PRICE;
    playersByTicket.push(); // skip slot 0 because ticket ID 0 is invalid
    _rounds.push(); // skip slot 0 because round 0 is invalid
    _rounds.push(); // initialize first round
    RoundData storage round = _rounds[1];
    round.baseTicketPrice = _baseTicketPrice;
    _open = true;
    _nextDrawTime = Drawing.getNextDrawingWindow();
    emit NewRound(1, round.baseTicketPrice, round.prizes, round.stash);
  }

  function initialize(address _vrfCoordinator) public initializer {
    __UUPSUpgradeable_init();
    __Ownable_init(msg.sender);
    __Pausable_init();
    __ReentrancyGuard_init();
    __Lottery_init_unchained(_vrfCoordinator);
  }

  function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

  /// @notice For emergency response.
  function pause() public onlyOwner {
    _pause();
  }

  /// @notice For emergency response.
  function unpause() public onlyOwner {
    _unpause();
  }

  /// @dev Calculates the binomial coefficient (n choose 6).
  function _choose6(uint n) private pure returns (uint) {
    if (n < 6) {
      return 0;
    }
    return (n * (n - 1) * (n - 2) * (n - 3) * (n - 4) * (n - 5)) / 720;
  }

  /// @dev Calculates the binomial coefficient (n choose k).
  function _choose(uint n, uint k) private pure returns (uint) {
    if (k > n) {
      return 0;
    } else if (k == 0) {
      return 1;
    } else if (k * 2 > n) {
      return _choose(n, n - k);
    } else {
      return (n * _choose(n - 1, k - 1)) / k;
    }
  }

  function _validateTicket(uint8[] calldata numbers) private view {
    if (!_open) {
      revert SalesAreClosedError();
    }
    if (numbers.length < 6 || numbers.length > 90) {
      revert InvalidNumbersError(numbers);
    }
    for (uint i = 0; i < numbers.length; i++) {
      if (numbers[i] < 1 || numbers[i] > 90) {
        revert InvalidNumbersError(numbers);
      }
      for (uint j = i + 1; j < numbers.length; j++) {
        if (numbers[i] == numbers[j]) {
          revert InvalidNumbersError(numbers);
        }
      }
    }
  }

  /// @notice Returns the price of a 6-number ticket for the current round.
  function getBaseTicketPrice() public view returns (uint256) {
    return _getCurrentRoundData().baseTicketPrice;
  }

  /// @notice Updates the base ticket price, i.e. the price of a 6-number ticket. As explained in
  ///   the note for the `_baseTicketPrice` field, this change will be effective at the start of the
  ///   next round.
  function setBaseTicketPrice(uint newPrice) public onlyOwner {
    _baseTicketPrice = newPrice;
    emit NewBaseTicketPrice(newPrice);
  }

  /// @return uint The current round number.
  function getCurrentRound() public view returns (uint) {
    return _rounds.length - 1;
  }

  function _getCurrentRoundData() private view returns (RoundData storage) {
    return _rounds[_rounds.length - 1];
  }

  /// @return bool True if ticket sales are open, false if a drawing is in progress.
  function isOpen() public view returns (bool) {
    return _open;
  }

  /// @notice Accept funds from ICO and other sources. Funds must never be transferred directly to
  ///   the lottery using the `transfer` method of the currency token, otherwise the lottery won't
  ///   be able to update its jackpot and stash correctly. Instead, funds must first be approved
  ///   using the `approve` method of the currency token and then transferred using this method.
  /// @param source The address to take funds from.
  /// @param value The amount to take, which must be approved by `source`.
  function fund(address source, uint256 value) public whenNotPaused {
    uint currentRound = getCurrentRound();
    uint256 stash = (value * 60) / 248;
    _rounds[currentRound].prizes[4] += value - stash;
    _rounds[currentRound].stash += stash;
    CURRENCY_TOKEN.transferFrom(source, address(this), value);
  }

  /// @notice Returns the latest prizes for each winning category. The value returned at index 0 is
  ///   the prize for the 2-match category, the value at index 1 is for the 3-match category, etc.
  ///   These values are updated in real time as users create tickets, so they can be queried at
  ///   every new block.
  function getPrizes() public view returns (uint256[5] memory prizes) {
    RoundData storage round = _getCurrentRoundData();
    uint256 value = round.baseTicketPrice * round.totalCombinations;
    value -= (value / 10) * 2;
    prizes = round.prizes;
    prizes[0] += (value * 188) / 1000;
    prizes[1] += (value * 188) / 1000;
    prizes[2] += (value * 188) / 1000;
    prizes[3] += (value * 188) / 1000;
    prizes[4] += (value * 188) / 1000;
  }

  /// @notice Returns the latest jackpot; that is, the prize for the 6-match category if exactly one
  ///   ticket wins it. Equivalent to `getPrizes()[4]`. This value is updated in real time as users
  ///   create tickets, so it can be queried at every new block.
  function getJackpot() public view returns (uint256) {
    RoundData storage round = _getCurrentRoundData();
    uint256 value = round.baseTicketPrice * round.totalCombinations;
    value -= (value / 10) * 2;
    return round.prizes[4] + (value * 188) / 1000;
  }

  /// @notice Returns the amount stashed to fund the jackpot of the next round in case someone
  ///   matches all 6 numbers (this amount is retained from 6% of the value of every ticket sold).
  function getStash() public view returns (uint256) {
    RoundData storage round = _getCurrentRoundData();
    uint256 value = round.baseTicketPrice * round.totalCombinations;
    value -= (value / 10) * 2;
    return round.stash + value - ((value * 188) / 1000) * 5;
  }

  /// @notice Returns the owner fees collected so far in the current round.
  function getOwnerRevenue() public view returns (uint256) {
    RoundData storage round = _getCurrentRoundData();
    uint256 ownerFees = (round.baseTicketPrice * round.totalCombinations) / 10;
    uint256 referralFees = (round.baseTicketPrice * round.combinationsByReferralCode[0]) / 10;
    return ownerFees + referralFees;
  }

  /// @notice Returns the partner fees collected so far in the current round.
  function getPartnerRevenue(bytes32 referralCode) public view returns (uint256) {
    RoundData storage round = _getCurrentRoundData();
    return (round.baseTicketPrice * round.combinationsByReferralCode[referralCode]) / 10;
  }

  /// @notice Returns the total fees collected so far in the current round. This is equivalent to
  ///   `getOwnerRevenue()` plus `getPartnerRevenue()` for all existing referral codes.
  function getTotalRevenue() public view returns (uint256) {
    RoundData storage round = _getCurrentRoundData();
    uint256 totalValue = round.baseTicketPrice * round.totalCombinations;
    return (totalValue / 10) * 2;
  }

  /// @notice Returns the total number of tickets ever sold, through all rounds.
  function getTotalTicketCount() public view returns (uint) {
    // subtract 1 because ID 0 is invalid / slot 0 is unused
    return playersByTicket.length - 1;
  }

  /// @notice Associates the specified referral `code` with the provided `address`. Reverts if the
  ///   referral code is already associated to another account. After association the code can be
  ///   used to resell tickets.
  function claimReferralCode(bytes32 code, address partner) public whenNotPaused {
    if (code == 0 || partnersByReferralCode[code] != address(0)) {
      revert ReferralCodeAlreadyExistsError(code);
    }
    partnersByReferralCode[code] = partner;
    referralCodesByPartner[partner].push(code);
    emit ClaimReferralCode(code, partner);
  }

  /// @notice Generates a new referral code and associates it to the provided account as per
  ///   `claimReferralCode`.
  function makeReferralCode(address partner) public whenNotPaused returns (bytes32) {
    bytes32 code = keccak256(abi.encodePacked("ExaLotto_Referral", block.timestamp, partner));
    claimReferralCode(code, partner);
    return code;
  }

  /// @notice Returns the price in wei of a ticket with the specified numbers. It also performs some
  ///   validation on the numbers (e.g. it checks that there are no duplicates and every number is
  ///   in the range [1, 90]) and reverts if validation fails.
  function getTicketPrice(uint8[] calldata numbers) public view returns (uint256) {
    _validateTicket(numbers);
    return _getCurrentRoundData().baseTicketPrice * _choose6(numbers.length);
  }

  /// @notice Creates a lottery ticket. The ticket will be associated to `msg.sender`, which will be
  ///   the only account able to withdraw any prizes attributed to the ticket. The price of the
  ///   ticket can be queried beforehand with `getTicketPrice`, and the `createTicket` function will
  ///   try to transfer that amount of the `CURRENCY_TOKEN` from `msg.sender` to the lottery
  ///   contract, reverting if the transfer fails. Be sure the correct amount is approved before
  ///   invoking `createTicket`.
  /// @param referralCode An optional referral code. If specified it must be valid, i.e. it must
  ///   have been claimed with `claimReferralCode` or `makeReferralCode`. When a non-zero referral
  ///   code is provided the referrer will get a small share of the ticket price.
  /// @param numbers The numbers of the ticket. Must be at least 6 and at most 90, and all must be
  ///   in the range [1, 90].
  function createTicket(
    bytes32 referralCode,
    uint8[] calldata numbers
  ) public whenNotPaused nonReentrant {
    _validateTicket(numbers);
    uint combinations = _choose6(numbers.length);
    uint currentRound = getCurrentRound();
    uint256 price = _rounds[currentRound].baseTicketPrice * combinations;
    address partnerAccount = partnersByReferralCode[referralCode];
    if (referralCode != 0 && partnerAccount == address(0)) {
      revert InvalidReferralCodeError(referralCode);
    }
    uint ticketId = playersByTicket.length;
    uint256 hash = _rounds[currentRound].ticketIndex.indexTicket(numbers);
    _ticketsByPlayer[msg.sender].push(
      TicketData({
        hash: hash,
        blockNumber: uint128(block.number),
        id: uint64(ticketId),
        round: uint32(currentRound),
        cardinality: uint16(numbers.length),
        withdrawn: false
      })
    );
    playersByTicket.push(msg.sender);
    _rounds[currentRound].totalCombinations += combinations;
    _rounds[currentRound].combinationsByReferralCode[referralCode] += combinations;
    CURRENCY_TOKEN.transferFrom(msg.sender, address(this), price);
    emit Ticket(currentRound, msg.sender, ticketId, numbers, referralCode);
  }

  /// @notice Creates a lottery ticket with 6 numbers. This is exactly the same as calling
  ///   `createTicket` with 6 numbers, but consumes a bit less gas.
  function createTicket6(
    bytes32 referralCode,
    uint8[6] calldata numbers
  ) public whenNotPaused nonReentrant {
    require(_open);
    uint currentRound = getCurrentRound();
    address partnerAccount = partnersByReferralCode[referralCode];
    require(referralCode == 0 || partnerAccount != address(0));
    for (uint i = 0; i < 6; i++) {
      require(numbers[i] > 0 && numbers[i] <= 90);
      for (uint j = i + 1; j < 6; j++) {
        require(numbers[i] != numbers[j]);
      }
    }
    uint ticketId = playersByTicket.length;
    uint256 hash = _rounds[currentRound].ticketIndex.indexTicket6(numbers);
    _ticketsByPlayer[msg.sender].push(
      TicketData({
        hash: hash,
        blockNumber: uint128(block.number),
        id: uint64(ticketId),
        round: uint32(currentRound),
        cardinality: 6,
        withdrawn: false
      })
    );
    playersByTicket.push(msg.sender);
    _rounds[currentRound].totalCombinations++;
    _rounds[currentRound].combinationsByReferralCode[referralCode]++;
    CURRENCY_TOKEN.transferFrom(msg.sender, address(this), _rounds[currentRound].baseTicketPrice);
    emit Ticket6(currentRound, msg.sender, ticketId, numbers, referralCode);
  }

  /// @notice Returns the IDs of all the ticket ever bought by a player.
  function getTicketIds(address player) public view returns (uint[] memory ids) {
    return _ticketsByPlayer[player].getTicketIds();
  }

  /// @notice Returns the IDs of the tickets a player bought at the specified round.
  function getTicketIdsForRound(
    address player,
    uint round
  ) public view returns (uint[] memory ids) {
    if (round == 0 || round >= _rounds.length) {
      revert InvalidRoundNumberError(round);
    }
    return _ticketsByPlayer[player].getTicketIdsForRound(round);
  }

  /// @notice Returns information about a ticket.
  /// @return player The account that created the ticket.
  /// @return round The number of the round when the ticket was created.
  /// @return blockNumber The block number at which the ticket was created.
  /// @return numbers The numbers in the ticket.
  function getTicket(
    uint ticketId
  ) public view returns (address player, uint round, uint256 blockNumber, uint8[] memory numbers) {
    player = playersByTicket[ticketId];
    if (player == address(0)) {
      revert InvalidTicketIdError(ticketId);
    }
    TicketData storage ticket;
    (ticket, numbers) = _ticketsByPlayer[player].getTicketAndNumbers(ticketId);
    round = ticket.round;
    blockNumber = ticket.blockNumber;
    return (player, round, blockNumber, numbers);
  }

  /// @notice Returns information about a round. Reverts if `roundNumber` is 0 or refers to the
  ///   current round or higher. The information about the current round is incomplete and cannot be
  ///   obtained by this method, but other methods can be used to query the available parts.
  /// @return baseTicketPrice The price in wei of a 6-number ticket for this round.
  /// @return prizes The prizes for each of the 5 winning category: `prizes[0]` is the prize
  ///   allocated for the 2-match category, `prizes[1]` for the 3-match category, and so on.
  ///   `prizes[4]` is the jackpot.
  /// @return stash A stash of money collected by withholding a percentage of the ticket sales.
  ///   This is used to fund the jackpot of the next round in case someone matches all 6 numbers. It
  ///   is simply carried over otherwise.
  /// @return totalCombinations The total number of played 6-combinations.
  /// @return drawBlockNumber The number of the block containing the `draw` method call
  ///   transaction.
  /// @return vrfRequestId The ChainLink VRF request ID.
  /// @return numbers The 6 drawn numbers.
  /// @return closureBlockNumber The number of the block containing the VRF callback transaction.
  /// @return winners The number of winning 6-combinations in each category. `winners[0]` is the
  ///   number of combinations with 2 matches, `winners[1]` is the number of combinations with 3
  ///   matches, and so on. Some of these numbers may be zero. if `winners[4] > 0` it means someone
  ///   won the jackpot.
  function getRoundData(
    uint roundNumber
  )
    public
    view
    returns (
      uint256 baseTicketPrice,
      uint256[5] memory prizes,
      uint256 stash,
      uint totalCombinations,
      uint256 drawBlockNumber,
      uint256 vrfRequestId,
      uint8[6] memory numbers,
      uint256 closureBlockNumber,
      uint[5] memory winners
    )
  {
    if (roundNumber == 0 || roundNumber >= _rounds.length - 1) {
      revert InvalidRoundNumberError(roundNumber);
    }
    RoundData storage round = _rounds[roundNumber];
    baseTicketPrice = round.baseTicketPrice;
    prizes = round.prizes;
    stash = round.stash;
    totalCombinations = round.totalCombinations;
    drawBlockNumber = round.drawBlockNumber;
    vrfRequestId = round.vrfRequestId;
    numbers = round.numbers;
    closureBlockNumber = round.closureBlockNumber;
    winners = round.winners;
  }

  /// @notice Returns the number of referrals for the specified code and round. Note that this is
  ///   the number of 6-combinations sold with the code, not the number of tickets.
  function getReferrals(bytes32 referralCode, uint roundNumber) public view returns (uint) {
    if (referralCode != 0 && partnersByReferralCode[referralCode] == address(0)) {
      revert InvalidReferralCodeError(referralCode);
    }
    if (roundNumber == 0 || roundNumber >= _rounds.length - 1) {
      revert InvalidRoundNumberError(roundNumber);
    }
    return _rounds[roundNumber].combinationsByReferralCode[referralCode];
  }

  /// @notice Indicates whether a draw can be triggered at this time. True iff we are in a drawing
  ///   window and no drawing has been triggered in this window.
  function canDraw() public view returns (bool) {
    return _open && block.timestamp >= _nextDrawTime && Drawing.insideDrawingWindow();
  }

  /// @notice Returns the time of next draw, which may be in the past if we are currently in a
  ///   drawing window and the draw hasn't been triggered yet.
  function getNextDrawTime() public view returns (uint) {
    if (canDraw()) {
      return Drawing.getCurrentDrawingWindow();
    } else {
      return Drawing.getNextDrawingWindow();
    }
  }

  /// @notice Triggers the drawing process. Fails if called outside of a drawing window.
  function draw(uint64 vrfSubscriptionId, bytes32 vrfKeyHash) public onlyOwner {
    if (!canDraw()) {
      revert InvalidStateError();
    }
    _open = false;
    _nextDrawTime = Drawing.getNextDrawingWindow();
    RoundData storage round = _getCurrentRoundData();
    round.drawBlockNumber = block.number;
    round.vrfRequestId = vrfCoordinator.requestRandomWords(
      vrfKeyHash,
      vrfSubscriptionId,
      VRF_REQUEST_CONFIRMATIONS,
      VRF_CALLBACK_GAS_LIMIT,
      /*numWords=*/ 1
    );
    emit VRFRequest(getCurrentRound(), vrfSubscriptionId, round.vrfRequestId);
  }

  /// @notice Cancels a failed drawing, i.e. one for which the ChainLink VRF never responded. Can
  ///   only be invoked after the end of a drawing window. This method resets the state of the
  ///   current round as if no drawing had been attempted at all. As a result, should ChainLink ever
  ///   decide to finalize the pending request, the VRF callback will fail.
  function cancelFailedDrawing() public onlyOwner {
    if (!_open && !Drawing.insideDrawingWindow()) {
      _open = true;
    } else {
      revert InvalidStateError();
    }
  }

  /// @dev Initializes a new round, calculating the new ticket price and carrying over the prizes
  ///   and stash.
  function _createNewRound() private {
    RoundData storage previousRound = _getCurrentRoundData();
    _rounds.push();
    RoundData storage newRound = _getCurrentRoundData();
    newRound.baseTicketPrice = _baseTicketPrice;
    if (previousRound.winners[0] == 0) newRound.prizes[0] = previousRound.prizes[0];
    if (previousRound.winners[1] == 0) newRound.prizes[1] = previousRound.prizes[1];
    if (previousRound.winners[2] == 0) newRound.prizes[2] = previousRound.prizes[2];
    if (previousRound.winners[3] == 0) newRound.prizes[3] = previousRound.prizes[3];
    if (previousRound.winners[4] > 0) {
      newRound.prizes[4] = previousRound.stash;
    } else {
      newRound.prizes[4] = previousRound.prizes[4];
      newRound.stash = previousRound.stash;
    }
  }

  /// @notice ChainLink VRF callback.
  function rawFulfillRandomWords(
    uint256 requestId,
    uint256[] memory randomWords
  ) external whenNotPaused {
    if (msg.sender != address(vrfCoordinator)) {
      revert OnlyCoordinatorCanFulfill(msg.sender, address(vrfCoordinator));
    }
    if (_open) {
      revert InvalidStateError();
    }
    uint roundNumber = getCurrentRound();
    RoundData storage round = _getCurrentRoundData();
    if (requestId != round.vrfRequestId) {
      revert VRFRequestError(requestId, round.vrfRequestId);
    }
    round.closureBlockNumber = block.number;
    uint8[6] memory numbers = Drawing.getRandomNumbersWithoutRepetitions(randomWords[0]);
    round.prizes = getPrizes();
    round.stash = getStash();
    round.numbers = numbers;
    round.winners = round.ticketIndex.findWinners(numbers);
    uint256 ownerRevenue = getOwnerRevenue();
    _createNewRound();
    _open = true;
    CURRENCY_TOKEN.transfer(owner(), ownerRevenue);
    emit Draw(roundNumber, round.totalCombinations, round.numbers, round.winners, round.prizes);
  }

  /// @dev Returns the prize assigned to a ticket, which may be zero, along with other information.
  function _getPrizeData(
    uint ticketId
  ) private view returns (address player, TicketData storage ticket, uint256 prize) {
    if (ticketId >= playersByTicket.length) {
      revert InvalidTicketIdError(ticketId);
    }
    player = playersByTicket[ticketId];
    ticket = _ticketsByPlayer[player].getTicket(ticketId);
    if (ticket.round >= getCurrentRound()) {
      // The data for the current round is incomplete, so we can't calculate the prize for this
      // ticket.
      revert InvalidRoundNumberError(ticket.round);
    }
    RoundData storage round = _rounds[ticket.round];
    uint8 matches = 0;
    if (ticket.hash % TicketIndex.getPrime(round.numbers[0]) == 0) matches++;
    if (ticket.hash % TicketIndex.getPrime(round.numbers[1]) == 0) matches++;
    if (ticket.hash % TicketIndex.getPrime(round.numbers[2]) == 0) matches++;
    if (ticket.hash % TicketIndex.getPrime(round.numbers[3]) == 0) matches++;
    if (ticket.hash % TicketIndex.getPrime(round.numbers[4]) == 0) matches++;
    if (ticket.hash % TicketIndex.getPrime(round.numbers[5]) == 0) matches++;
    prize = 0;
    for (uint i = 2; i <= matches; i++) {
      uint weight = _choose(matches, i) * _choose(ticket.cardinality - matches, 6 - i);
      if (weight > 0) {
        prize += (round.prizes[i - 2] * weight) / round.winners[i - 2];
      }
    }
  }

  /// @notice Returns the prize won by a ticket, which may be zero, and a boolean indicating whether
  ///   it has been withdrawn. Reverts if the ticket ID is invalid or refers to a ticket played in
  ///   the current round.
  /// @return player The address the prize can be sent to.
  /// @return prize The prize won by the ticket.
  /// @return withdrawn Whether the prize has been withdrawn by the user.
  function getTicketPrize(
    uint ticketId
  ) public view returns (address player, uint256 prize, bool withdrawn) {
    TicketData storage ticket;
    (player, ticket, prize) = _getPrizeData(ticketId);
    withdrawn = ticket.withdrawn;
  }

  /// @notice Allows a user to withdraw the prize won by the specified ticket. Reverts if the ticket
  ///   ID is invalid, the ticket has no prize, or the prize has already been withdrawn.
  function withdrawPrize(uint ticketId) public whenNotPaused nonReentrant {
    (address player, TicketData storage ticket, uint256 prize) = _getPrizeData(ticketId);
    if (prize == 0) {
      revert NoPrizeError(ticketId);
    }
    if (ticket.withdrawn) {
      revert PrizeAlreadyWithdrawnError(ticketId);
    }
    ticket.withdrawn = true;
    CURRENCY_TOKEN.transfer(player, prize);
    emit PrizeWithdrawal(ticketId, player, prize);
  }
}
