import { expect } from 'chai';

import { ethers } from 'hardhat';
import type { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers';
import { takeSnapshot } from '@nomicfoundation/hardhat-network-helpers';

import type { Signer } from 'ethers';
import type { FakeToken, Lottery, LotteryICO, LotteryToken } from '../typechain-types';

import { Deployer } from '../scripts/deployer';

const NULL_REFERRAL_CODE = '0x0000000000000000000000000000000000000000000000000000000000000000';

const ONE_WEEK = 60 * 60 * 24 * 7;

describe('ICO', () => {
  const deployer = new Deployer();

  let owner: Signer;
  let partner1: Signer;
  let partner2: Signer;

  let snapshot: SnapshotRestorer;

  let currencyToken: FakeToken;
  let token: LotteryToken;
  let lottery: Lottery;
  let lotteryAddress: string;
  let ico: LotteryICO;
  let icoAddress: string;

  let totalSupply: bigint;
  const price = 750000000000000000n; // 0.75

  before(async () => {
    await deployer.init();
    const signers = await ethers.getSigners();
    owner = signers[0];
    partner1 = signers[1];
    partner2 = signers[2];
    currencyToken = await deployer.deployFakeTokenForTesting();
    const vrfCoordinator = await deployer.deployMockVRFCoordinator();
    const [currencyTokenAddress, vrfCoordinatorAddress] = await Promise.all([
      currencyToken.getAddress(),
      vrfCoordinator.getAddress(),
    ]);
    ({ token, lottery, ico } = await deployer.deployAll(
      currencyTokenAddress,
      vrfCoordinatorAddress,
    ));
    [lotteryAddress, icoAddress] = await Promise.all([lottery.getAddress(), ico.getAddress()]);
    totalSupply = await token.totalSupply();
  });

  beforeEach(async () => {
    snapshot = await takeSnapshot();
  });

  afterEach(async () => {
    await snapshot.restore();
  });

  const getPrice = (amount: number | bigint) => (BigInt(amount) * price) / 10n ** 18n;

  const buyTokens = async (signer: Signer, amount: number | bigint) => {
    await currencyToken.connect(signer).mint(amount);
    await currencyToken.connect(signer).approve(icoAddress, getPrice(amount));
    await ico.connect(signer).buyTokens(amount);
  };

  it('initial state', async () => {
    expect(await currencyToken.balanceOf(icoAddress)).to.equal(0);
    expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(0);
    expect(await token.balanceOf(icoAddress)).to.equal(totalSupply);
    expect(await ico.currencyToken()).to.equal(await currencyToken.getAddress());
    expect(await ico.token()).to.equal(await token.getAddress());
    expect(await ico.lottery()).to.equal(await lottery.getAddress());
    expect(await ico.tokensForSale()).to.equal(0);
    expect(await ico.tokensSold()).to.equal(0);
    expect(await ico.isOpen()).to.equal(false);
    expect(await ico.balanceOf(owner)).to.equal(0);
    expect(await ico.balanceOf(partner1)).to.equal(0);
    expect(await ico.balanceOf(partner2)).to.equal(0);
    await expect(buyTokens(partner1, 1)).to.be.reverted;
    await expect(buyTokens(partner2, 1)).to.be.reverted;
  });

  it('open', async () => {
    await ico.open(12345, price);
    expect(await currencyToken.balanceOf(icoAddress)).to.equal(0);
    expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(0);
    expect(await token.balanceOf(icoAddress)).to.equal(totalSupply);
    expect(await ico.tokensForSale()).to.equal(12345);
    expect(await ico.tokensSold()).to.equal(0);
    expect(await ico.price()).to.equal(price);
    expect(await ico.isOpen()).to.equal(true);
    expect(await token.balanceOf(icoAddress)).to.equal(totalSupply);
    expect(await ico.balanceOf(owner)).to.equal(0);
    expect(await ico.balanceOf(partner1)).to.equal(0);
    expect(await ico.balanceOf(partner2)).to.equal(0);
  });

  it('partner 1 buys', async () => {
    await ico.open(12345, price);
    await buyTokens(partner1, 123);
    expect(await currencyToken.balanceOf(icoAddress)).to.equal(getPrice(123));
    expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(0);
    expect(await token.balanceOf(icoAddress)).to.equal(totalSupply);
    expect(await ico.tokensForSale()).to.equal(12345);
    expect(await ico.tokensSold()).to.equal(123);
    expect(await ico.balanceOf(owner)).to.equal(0);
    expect(await ico.balanceOf(partner1)).to.equal(123);
    expect(await ico.balanceOf(partner2)).to.equal(0);
  });

  it('partner 2 buys', async () => {
    await ico.open(12345, price);
    await buyTokens(partner2, 321);
    expect(await currencyToken.balanceOf(icoAddress)).to.equal(getPrice(321));
    expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(0);
    expect(await token.balanceOf(icoAddress)).to.equal(totalSupply);
    expect(await ico.tokensForSale()).to.equal(12345);
    expect(await ico.tokensSold()).to.equal(321);
    expect(await ico.balanceOf(owner)).to.equal(0);
    expect(await ico.balanceOf(partner1)).to.equal(0);
    expect(await ico.balanceOf(partner2)).to.equal(321);
  });

  it('both buy', async () => {
    await ico.open(12345, price);
    await buyTokens(partner1, 321);
    await buyTokens(partner2, 123);
    expect(await currencyToken.balanceOf(icoAddress)).to.equal(getPrice(321) + getPrice(123));
    expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(0);
    expect(await token.balanceOf(icoAddress)).to.equal(totalSupply);
    expect(await ico.tokensForSale()).to.equal(12345);
    expect(await ico.tokensSold()).to.equal(123 + 321);
    expect(await ico.balanceOf(owner)).to.equal(0);
    expect(await ico.balanceOf(partner1)).to.equal(321);
    expect(await ico.balanceOf(partner2)).to.equal(123);
  });

  it('buy twice', async () => {
    await ico.open(12345, price);
    await buyTokens(partner1, 123);
    await buyTokens(partner1, 321);
    expect(await currencyToken.balanceOf(icoAddress)).to.equal(getPrice(123) + getPrice(321));
    expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(0);
    expect(await token.balanceOf(icoAddress)).to.equal(totalSupply);
    expect(await ico.tokensForSale()).to.equal(12345);
    expect(await ico.tokensSold()).to.equal(123 + 321);
    expect(await ico.balanceOf(owner)).to.equal(0);
    expect(await ico.balanceOf(partner1)).to.equal(123 + 321);
    expect(await ico.balanceOf(partner2)).to.equal(0);
  });

  it('buy too many', async () => {
    await ico.open(1234, price);
    await expect(buyTokens(partner1, 12345)).to.be.reverted;
  });

  it('cannot withdraw while open', async () => {
    await ico.open(12345, price);
    await buyTokens(partner1, 1234);
    await expect(ico.connect(partner1).withdraw(123)).to.be.reverted;
  });

  it('close', async () => {
    await ico.open(12345, price);
    await ico.close();
    expect(await currencyToken.balanceOf(icoAddress)).to.equal(0);
    expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(0);
    expect(await token.balanceOf(icoAddress)).to.equal(totalSupply);
    expect(await ico.tokensForSale()).to.equal(12345);
    expect(await ico.tokensSold()).to.equal(0);
    expect(await ico.isOpen()).to.equal(false);
    expect(await ico.balanceOf(owner)).to.equal(0);
    expect(await ico.balanceOf(partner1)).to.equal(0);
    expect(await ico.balanceOf(partner2)).to.equal(0);
  });

  it('buy and close', async () => {
    await ico.open(12345, price);
    await buyTokens(partner1, 123);
    await ico.close();
    const value = getPrice(123);
    const stash = (value * 60n) / 248n;
    expect(await currencyToken.balanceOf(icoAddress)).to.equal(0);
    expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(value);
    expect(await lottery.getJackpot()).to.equal(value - stash);
    expect(await lottery.getStash()).to.equal(stash);
    expect(await token.balanceOf(icoAddress)).to.equal(totalSupply);
    expect(await ico.tokensForSale()).to.equal(12345);
    expect(await ico.tokensSold()).to.equal(123);
    expect(await ico.isOpen()).to.equal(false);
    expect(await ico.balanceOf(owner)).to.equal(0);
    expect(await ico.balanceOf(partner1)).to.equal(123);
    expect(await ico.balanceOf(partner2)).to.equal(0);
  });

  it('both buy and close', async () => {
    await ico.open(12345, price);
    await buyTokens(partner1, 321);
    await buyTokens(partner2, 123);
    await ico.close();
    const value = getPrice(321) + getPrice(123);
    const stash = (value * 60n) / 248n;
    expect(await currencyToken.balanceOf(icoAddress)).to.equal(0);
    expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(value);
    expect(await lottery.getJackpot()).to.equal(value - stash);
    expect(await lottery.getStash()).to.equal(stash);
    expect(await token.balanceOf(icoAddress)).to.equal(totalSupply);
    expect(await ico.tokensForSale()).to.equal(12345);
    expect(await ico.tokensSold()).to.equal(321 + 123);
    expect(await ico.isOpen()).to.equal(false);
    expect(await ico.balanceOf(owner)).to.equal(0);
    expect(await ico.balanceOf(partner1)).to.equal(321);
    expect(await ico.balanceOf(partner2)).to.equal(123);
  });

  it('buy many and close', async () => {
    await ico.open(12345, price);
    await buyTokens(partner1, 321);
    await buyTokens(partner1, 123);
    await buyTokens(partner2, 456);
    await ico.close();
    const value = getPrice(321) + getPrice(123) + getPrice(456);
    const stash = (value * 60n) / 248n;
    expect(await currencyToken.balanceOf(icoAddress)).to.equal(0);
    expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(value);
    expect(await lottery.getJackpot()).to.equal(value - stash);
    expect(await lottery.getStash()).to.equal(stash);
    expect(await token.balanceOf(icoAddress)).to.equal(totalSupply);
    expect(await ico.tokensForSale()).to.equal(12345);
    expect(await ico.tokensSold()).to.equal(321 + 123 + 456);
    expect(await ico.isOpen()).to.equal(false);
    expect(await ico.balanceOf(owner)).to.equal(0);
    expect(await ico.balanceOf(partner1)).to.equal(321 + 123);
    expect(await ico.balanceOf(partner2)).to.equal(456);
  });

  it('withdraw', async () => {
    await ico.open(12345, price);
    await buyTokens(partner1, 123);
    await ico.close();
    await ico.connect(partner1).withdraw(12);
    const value = getPrice(123);
    const stash = (value * 60n) / 248n;
    expect(await currencyToken.balanceOf(icoAddress)).to.equal(0);
    expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(value);
    expect(await lottery.getJackpot()).to.equal(value - stash);
    expect(await lottery.getStash()).to.equal(stash);
    expect(await token.balanceOf(icoAddress)).to.equal(totalSupply - 12n);
    expect(await token.balanceOf(owner)).to.equal(0);
    expect(await token.balanceOf(partner1)).to.equal(12);
    expect(await token.balanceOf(partner2)).to.equal(0);
    expect(await ico.isOpen()).to.equal(false);
    expect(await ico.balanceOf(owner)).to.equal(0);
    expect(await ico.balanceOf(partner1)).to.equal(123 - 12);
    expect(await ico.balanceOf(partner2)).to.equal(0);
  });

  it('liquid withdraw', async () => {
    await ico.open(12345, price);
    await buyTokens(partner1, 123);
    await buyTokens(partner1, 321);
    await ico.close();
    await ico.connect(partner1).withdraw(200);
    const value = getPrice(123) + getPrice(321);
    const stash = (value * 60n) / 248n;
    expect(await currencyToken.balanceOf(icoAddress)).to.equal(0);
    expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(value);
    expect(await lottery.getJackpot()).to.equal(value - stash);
    expect(await lottery.getStash()).to.equal(stash);
    expect(await token.balanceOf(icoAddress)).to.equal(totalSupply - 200n);
    expect(await token.balanceOf(owner)).to.equal(0);
    expect(await token.balanceOf(partner1)).to.equal(200);
    expect(await token.balanceOf(partner2)).to.equal(0);
    expect(await ico.isOpen()).to.equal(false);
    expect(await ico.balanceOf(owner)).to.equal(0);
    expect(await ico.balanceOf(partner1)).to.equal(244);
    expect(await ico.balanceOf(partner2)).to.equal(0);
  });

  it('both withdraw', async () => {
    await ico.open(12345, price);
    await buyTokens(partner1, 123);
    await buyTokens(partner1, 321);
    await buyTokens(partner2, 456);
    await buyTokens(partner2, 654);
    await ico.close();
    await ico.connect(partner1).withdraw(300);
    await ico.connect(partner2).withdraw(500);
    const value = getPrice(123) + getPrice(321) + getPrice(456) + getPrice(654);
    const stash = (value * 60n) / 248n;
    expect(await currencyToken.balanceOf(icoAddress)).to.equal(0);
    expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(value);
    expect(await lottery.getJackpot()).to.equal(value - stash);
    expect(await lottery.getStash()).to.equal(stash);
    expect(await token.balanceOf(icoAddress)).to.equal(totalSupply - 800n);
    expect(await token.balanceOf(owner)).to.equal(0);
    expect(await token.balanceOf(partner1)).to.equal(300);
    expect(await token.balanceOf(partner2)).to.equal(500);
    expect(await ico.isOpen()).to.equal(false);
    expect(await ico.balanceOf(owner)).to.equal(0);
    expect(await ico.balanceOf(partner1)).to.equal(144);
    expect(await ico.balanceOf(partner2)).to.equal(610);
  });

  it('cannot withdraw more than balance', async () => {
    await ico.open(12345, price);
    await buyTokens(partner1, 123);
    await buyTokens(partner1, 321);
    await buyTokens(partner2, 456);
    await buyTokens(partner2, 654);
    await ico.close();
    await expect(ico.connect(partner1).withdraw(1000)).to.be.reverted;
  });

  it('withdraw all', async () => {
    await ico.open(12345, price);
    await buyTokens(partner1, 123);
    await buyTokens(partner1, 321);
    await ico.close();
    await ico.connect(partner1).withdrawAll();
    const value = getPrice(123) + getPrice(321);
    const stash = (value * 60n) / 248n;
    expect(await currencyToken.balanceOf(icoAddress)).to.equal(0);
    expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(value);
    expect(await lottery.getJackpot()).to.equal(value - stash);
    expect(await lottery.getStash()).to.equal(stash);
    expect(await token.balanceOf(icoAddress)).to.equal(totalSupply - 444n);
    expect(await token.balanceOf(owner)).to.equal(0);
    expect(await token.balanceOf(partner1)).to.equal(444);
    expect(await token.balanceOf(partner2)).to.equal(0);
    expect(await ico.isOpen()).to.equal(false);
    expect(await ico.balanceOf(owner)).to.equal(0);
    expect(await ico.balanceOf(partner1)).to.equal(0);
    expect(await ico.balanceOf(partner2)).to.equal(0);
  });

  it('withdraw nothing', async () => {
    await ico.open(12345, price);
    await ico.close();
    await expect(ico.connect(partner1).withdrawAll()).to.be.reverted;
  });

  // TODO: test second round
});
