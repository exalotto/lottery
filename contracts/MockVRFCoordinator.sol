// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@chainlink/contracts/src/v0.8/vrf/mocks/VRFCoordinatorV2Mock.sol";

contract MockVRFCoordinator is VRFCoordinatorV2Mock {
  constructor() VRFCoordinatorV2Mock(0, 0) {}
}
