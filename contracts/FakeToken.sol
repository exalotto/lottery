// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20FlashMint} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20FlashMint.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @dev Fake, freely mintable ERC-20 token to use as currency token in unit tests.
contract FakeToken is ERC20, ERC20Burnable, ERC20Permit, ERC20FlashMint {
  constructor() ERC20("Fake", "FAKE") ERC20Permit("Fake") {}

  function mint(uint256 amount) public {
    _mint(msg.sender, amount);
  }
}
