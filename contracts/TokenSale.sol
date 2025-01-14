// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./Lottery.sol";
import "./Token.sol";

contract LotteryTokenSale is Ownable, Pausable, ReentrancyGuard {
  using SafeERC20 for IERC20;
  using SafeERC20 for LotteryToken;

  error InvalidStateError();
  error InsufficientTokensError(uint256 available, uint256 requested);
  error IncorrectValueError(uint256 got, uint256 want);
  error InsufficientBalanceError(uint256 amount, uint256 balance);

  /// @notice Address of the ERC-20 token used for buying EXL and eventually for lottery prizes.
  IERC20 public immutable currencyToken;

  /// @notice Address of the EXL token.
  LotteryToken public immutable token;

  /// @notice Address of the lottery smartcontract.
  Lottery public immutable lottery;

  /// @dev How many EXL-wei are being sold at this round.
  uint256 public tokensForSale = 0;

  /// @dev How many EXL-wei have been sold so far.
  uint256 public tokensSold = 0;

  /// @dev Price of 1 EXL in wei.
  uint256 public price;

  /// @dev True iff token sales are open.
  bool private _open = false;

  /// @dev EXL balances. Each address can withdraw its EXL only while the token sale is close.
  mapping(address => uint256) private _balances;

  modifier whenOpen() {
    if (!_open) {
      revert InvalidStateError();
    }
    _;
  }

  modifier whenClose() {
    if (_open) {
      revert InvalidStateError();
    }
    _;
  }

  constructor(IERC20 _currencyToken, LotteryToken _token, Lottery _lottery) Ownable(msg.sender) {
    currencyToken = _currencyToken;
    token = _token;
    lottery = _lottery;
  }

  /// @notice For emergency response.
  function pause() public onlyOwner {
    _pause();
  }

  /// @notice For emergency response.
  function unpause() public onlyOwner {
    _unpause();
  }

  /// @return True iff token sales are open.
  function isOpen() public view returns (bool) {
    return _open;
  }

  /// @notice Opens the token sale.
  /// @param tokensToSell How many EXL-wei can be sold.
  /// @param _price The price of 1 EXL in wei.
  function open(uint256 tokensToSell, uint256 _price) public onlyOwner whenClose nonReentrant {
    uint256 balance = token.balanceOf(address(this));
    if (tokensToSell > balance) {
      revert InsufficientTokensError(balance, tokensToSell);
    }
    tokensForSale = tokensToSell;
    tokensSold = 0;
    price = _price;
    _open = true;
  }

  /// @notice Closes the token sale.
  function close() public onlyOwner whenOpen nonReentrant {
    _open = false;
    uint256 value = currencyToken.balanceOf(address(this));
    currencyToken.approve(address(lottery), value);
    lottery.fund(address(this), value);
  }

  /// @return The EXL balance of an account, in EXL-wei.
  function balanceOf(address account) public view returns (uint256) {
    return _balances[account];
  }

  /// @return The price in wei of the specified amount of EXL-wei.
  function getPriceFor(uint256 tokenAmount) public view whenOpen returns (uint256) {
    return (price * tokenAmount) / (10 ** token.decimals());
  }

  /// @notice Buys the requested `amount` of EXL-wei and attributes them to the sender, reverting if
  ///   the token sale is close. An amount of `getPriceFor(amount)` wei of the currency token must
  ///   have been approved beforehand, otherwise the transaction will fail. Note that the acquired
  ///   EXL tokens are not yet transferred at this time, they're only associated with `msg.sender`.
  ///   This method can be invoked multiple times by the same caller and all acquired amounts will
  ///   add up. The EXL balance of an account can be retrieved by calling `balanceOf`.
  function buyTokens(uint256 amount) public whenOpen whenNotPaused nonReentrant {
    if (tokensSold + amount > tokensForSale) {
      revert InsufficientTokensError(tokensForSale, amount);
    }
    tokensSold += amount;
    _balances[msg.sender] += amount;
    currencyToken.safeTransferFrom(msg.sender, address(this), getPriceFor(amount));
  }

  /// @notice Transfers the requested EXL-wei `amount` to the sender, reverting if the token sale is
  ///   still open or if `amount > balanceOf(msg.sender)`.
  function withdraw(uint256 amount) public whenClose whenNotPaused nonReentrant {
    uint256 balance = _balances[msg.sender];
    if (amount > balance) {
      revert InsufficientBalanceError(amount, balance);
    }
    _balances[msg.sender] -= amount;
    token.safeTransfer(msg.sender, amount);
  }

  /// @notice Transfers all EXL balance (as per `balanceOf(msg.sender)`) to the sender. Reverts if
  ///   the token sale is still open.
  function withdrawAll() public whenClose whenNotPaused nonReentrant {
    uint256 balance = _balances[msg.sender];
    if (balance == 0) {
      revert InsufficientBalanceError(0, 0);
    }
    _balances[msg.sender] = 0;
    token.safeTransfer(msg.sender, balance);
  }
}
