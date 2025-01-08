// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/governance/TimelockController.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./Lottery.sol";
import "./Token.sol";

contract LotteryController is TimelockController, Pausable, ReentrancyGuard {
  struct Revenue {
    uint256 blockNumber;
    uint256 value;
    uint256 totalValue;
  }

  using SafeERC20 for IERC20;

  /// @notice Address of the EXL token.
  LotteryToken public immutable token;

  /// @notice Address of the lottery smartcontract.
  Lottery public immutable lottery;

  /// @dev Cumulative sum of all withdrawn amounts, by all partner accounts.
  uint256 private _totalWithdrawn = 0;

  /// @dev Revenue checkpoints.
  Revenue[] private _revenue;

  /// @notice Block number of the last withdrawal for each partner account.
  mapping(address => uint256) public lastWithdrawalBlock;

  constructor(
    LotteryToken _token,
    Lottery _lottery,
    address[] memory proposers,
    address[] memory executors
  ) TimelockController(/*minDelay=*/ 0 seconds, proposers, executors, /*admin=*/ msg.sender) {
    token = _token;
    lottery = _lottery;
  }

  /// @notice Returns the ERC-20 token used for payments and prizes.
  function currencyToken() public view returns (IERC20) {
    return lottery.currencyToken();
  }

  /// @notice Pauses both the lottery and the controller. For emergency response.
  function pause() public onlyRole(DEFAULT_ADMIN_ROLE) {
    _pause();
    lottery.pause();
  }

  /// @notice Unpauses both the lottery and the controller. For emergency response.
  function unpause() public onlyRole(DEFAULT_ADMIN_ROLE) {
    _unpause();
    lottery.unpause();
  }

  /// @notice Indicates whether or not a draw is allowed at this time.
  function canDraw() public view returns (bool) {
    return lottery.canDraw();
  }

  function _getLastRoundTotalRevenue() private view returns (uint256) {
    if (_revenue.length > 0) {
      return _revenue[_revenue.length - 1].totalValue;
    } else {
      return 0;
    }
  }

  /// @notice Triggers a drawing. Reverts if `canDraw() == false`.
  function draw(uint64 vrfSubscriptionId, bytes32 vrfKeyHash) public whenNotPaused nonReentrant {
    lottery.draw(vrfSubscriptionId, vrfKeyHash);
  }

  /// @notice Closes the round, making its revenue available for withdrawal.
  function closeRound() public whenNotPaused {
    require(lottery.isOpen() && !lottery.canDraw(), "invalid state");
    uint256 totalValue = currencyToken().balanceOf(address(this)) + _totalWithdrawn;
    _revenue.push(
      Revenue({
        blockNumber: block.number,
        value: totalValue - _getLastRoundTotalRevenue(),
        totalValue: totalValue
      })
    );
  }

  /// @notice Cancels a failed drawing, i.e. one for which the ChainLink VRF never responded. Can
  ///   only be invoked after the end of a drawing window. See the corresponding method in the
  ///   Lottery contract for more information.
  function cancelFailedDrawing() public whenNotPaused nonReentrant {
    lottery.cancelFailedDrawing();
  }

  /// @notice Returns the number of revenue checkpoints.
  function numRevenueRecords() public view returns (uint) {
    return _revenue.length;
  }

  /// @notice Returns information about the i-th revenue checkpoint. The first returned value is the
  ///   block number, the second is the revenue.
  function getRevenueRecord(uint index) public view returns (uint256, uint256) {
    require(index < _revenue.length, "invalid index");
    Revenue storage revenue = _revenue[index];
    return (revenue.blockNumber, revenue.value);
  }

  /// @notice Returns information about the revenue for a given partner account at the i-th
  ///   checkpoint.
  function getAccountRevenueRecord(
    address account,
    uint index
  ) public view returns (uint256 blockNumber, uint256 globalRevenue, uint256 accountRevenue) {
    require(index < _revenue.length, "invalid index");
    Revenue storage revenue = _revenue[index];
    blockNumber = revenue.blockNumber;
    globalRevenue = revenue.value;
    accountRevenue = 0;
    uint256 totalVotes = token.getPastTotalVotes(blockNumber);
    if (totalVotes > 0) {
      accountRevenue = (revenue.value * token.getPastVotes(account, blockNumber)) / totalVotes;
    }
  }

  function _getFirstUnclaimedRound(address account) private view returns (uint) {
    uint256 nextWithdrawalBlock = lastWithdrawalBlock[account] + 1;
    uint i = 0;
    uint j = _revenue.length;
    while (j > i) {
      uint k = i + ((j - i) >> 1);
      if (nextWithdrawalBlock > _revenue[k].blockNumber) {
        i = k + 1;
      } else {
        j = k;
      }
    }
    return i;
  }

  /// @notice Returns the total unclaimed revenue for the specified partner account, which is
  ///   calculated by adding up the partner's revenue at every checkpoint since its last withdrawal.
  function getUnclaimedRevenue(address account) public view returns (uint256 revenue) {
    revenue = 0;
    for (uint i = _getFirstUnclaimedRound(account); i < _revenue.length; i++) {
      uint256 pastBlock = _revenue[i].blockNumber;
      uint256 pastTotalVotes = token.getPastTotalVotes(pastBlock);
      if (pastTotalVotes > 0) {
        revenue += (_revenue[i].value * token.getPastVotes(account, pastBlock)) / pastTotalVotes;
      }
    }
  }

  /// @notice Withdraws any outstanding unclaimed revenue attributed to a specified partner account.
  ///   The revenue is automatically sent to that account.
  function withdraw(address account) public whenNotPaused nonReentrant {
    require(_revenue.length > 0, "nothing to withdraw");
    uint256 amount = getUnclaimedRevenue(account);
    require(amount > 0, "no revenue is available for withdrawal");
    _totalWithdrawn += amount;
    lastWithdrawalBlock[account] = _revenue[_revenue.length - 1].blockNumber;
    currencyToken().safeTransfer(account, amount);
  }
}
