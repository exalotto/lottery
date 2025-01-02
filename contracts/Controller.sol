// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/governance/TimelockController.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./Lottery.sol";
import "./Token.sol";

contract LotteryController is TimelockController, Pausable, ReentrancyGuard {
  /// @notice Address of the EXL token.
  LotteryToken public immutable token;

  /// @notice Address of the lottery smartcontract.
  Lottery public immutable lottery;

  constructor(
    LotteryToken _token,
    Lottery _lottery,
    address[] memory proposers,
    address[] memory executors
  ) TimelockController(0 seconds, proposers, executors, msg.sender) {
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

  // TODO
}
