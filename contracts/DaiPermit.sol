// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Describes the early implementation of EIP-2612 used by the Dai stablecoin. This early
///   implementation is mentioned in EIP-2612 but it's not compliant.
interface DaiPermit {
  function nonces(address owner) external view returns (uint256);

  function getNonce(address user) external view returns (uint256);

  function permit(
    address holder,
    address spender,
    uint256 nonce,
    uint256 expiry,
    bool allowed,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) external;
}
