// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/structs/Checkpoints.sol";
import "@openzeppelin/contracts/utils/Nonces.sol";

contract LotteryToken is ERC20, ERC20Burnable, ERC20Permit, ERC20Votes {
  using Checkpoints for Checkpoints.Trace208;

  /// @dev Keeps track of every change in the total delegated voting power.
  Checkpoints.Trace208 private _totalDelegationCheckpoints;

  constructor() ERC20("ExaLotto", "EXL") ERC20Permit("ExaLotto") {
    _mint(msg.sender, 1e9 ether);
  }

  /// @notice Returns the total delegated voting power.
  function getTotalVotes() public view returns (uint256) {
    return _totalDelegationCheckpoints.latest();
  }

  /// @notice Returns the total delegated voting power at a past point in time.
  function getPastTotalVotes(uint256 blockNumber) public view returns (uint256) {
    return _totalDelegationCheckpoints.upperLookup(SafeCast.toUint48(blockNumber));
  }

  function _moveDelegateVotes(address from, address to, uint256 amount) internal override {
    super._moveDelegateVotes(from, to, amount);
    uint256 votes = getTotalVotes();
    if (from == address(0) && to != address(0)) {
      votes += amount;
    }
    if (from != address(0) && to == address(0)) {
      votes -= amount;
    }
    _totalDelegationCheckpoints.push(SafeCast.toUint48(block.number), SafeCast.toUint208(votes));
  }

  // The following functions are overrides required by Solidity.

  function _update(address from, address to, uint256 amount) internal override(ERC20, ERC20Votes) {
    super._update(from, to, amount);
  }

  function nonces(address owner) public view override(ERC20Permit, Nonces) returns (uint256) {
    return super.nonces(owner);
  }
}
