// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./Lottery.sol";
import "./Token.sol";

contract LotteryICO is Ownable, ReentrancyGuard {
  error InvalidStateError();
  error InsufficientTokensError(uint256 available, uint256 requested);

  /// @notice Address of the ERC-20 token used for buying EXL and eventually for lottery prizes.
  IERC20 public immutable currencyToken;

  /// @notice Address of the EXL token.
  LotteryToken public immutable token;

  /// @notice Address of the lottery smartcontract.
  Lottery public immutable lottery;

  /// @dev How many EXL-wei are being sold.
  uint256 private _tokensForSale = 0;

  /// @dev Price of 1 EXL in wei.
  uint256 private _price;

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

  /// @return True iff token sales are open.
  function isOpen() public view returns (bool) {
    return _open;
  }

  /// @return The price of 1 EXL in wei.
  function getTokenPrice() public view whenOpen returns (uint256) {
    return _price;
  }

  /// @return How many EXL-wei are for sale.
  function getTokensForSale() public view whenOpen returns (uint256) {
    return _tokensForSale;
  }

  /// @notice Opens the token sale.
  /// @param tokensForSale How many EXL-wei can be sold.
  /// @param price The price of 1 EXL in wei.
  function open(uint256 tokensForSale, uint256 price) public onlyOwner whenClose {
    uint256 balance = token.balanceOf(address(this));
    if (tokensForSale > balance) {
      revert InsufficientTokensError(balance, tokensForSale);
    }
    _tokensForSale = tokensForSale;
    _price = price;
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
  function getPrice(uint256 tokenAmount) public view whenOpen returns (uint256) {
    return (_price * tokenAmount) / (10 ** token.decimals());
  }

  // TODO
}
