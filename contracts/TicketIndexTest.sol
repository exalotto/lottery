// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./TicketIndex.sol";

contract TicketIndexTest {
  function testGetPrime(uint8 i) public pure returns (uint16) {
    return TicketIndex.getPrime(i);
  }
}
