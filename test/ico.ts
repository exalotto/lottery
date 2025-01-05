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
  const price1 = 750000000000000000n; // 0.75
  const price2 = 1100000000000000000n; // 1.10

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

  const getPrice1 = (amount: number | bigint) => (BigInt(amount) * price1) / 10n ** 18n;
  const getPrice2 = (amount: number | bigint) => (BigInt(amount) * price2) / 10n ** 18n;

  const buyTokensAtPrice = async (signer: Signer, amount: number | bigint, price: bigint) => {
    await currencyToken.connect(signer).mint(price);
    await currencyToken.connect(signer).approve(icoAddress, price);
    await ico.connect(signer).buyTokens(amount);
  };

  const buyTokens1 = async (signer: Signer, amount: number | bigint) =>
    buyTokensAtPrice(signer, amount, getPrice1(amount));

  const buyTokens2 = async (signer: Signer, amount: number | bigint) =>
    buyTokensAtPrice(signer, amount, getPrice2(amount));

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
    await expect(buyTokens1(partner1, 1)).to.be.reverted;
    await expect(buyTokens1(partner2, 1)).to.be.reverted;
  });

  describe('first round', () => {
    it('open', async () => {
      await ico.open(12345, price1);
      expect(await currencyToken.balanceOf(icoAddress)).to.equal(0);
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(0);
      expect(await token.balanceOf(icoAddress)).to.equal(totalSupply);
      expect(await ico.tokensForSale()).to.equal(12345);
      expect(await ico.tokensSold()).to.equal(0);
      expect(await ico.price()).to.equal(price1);
      expect(await ico.isOpen()).to.equal(true);
      expect(await ico.balanceOf(owner)).to.equal(0);
      expect(await ico.balanceOf(partner1)).to.equal(0);
      expect(await ico.balanceOf(partner2)).to.equal(0);
    });

    it('partner 1 buys', async () => {
      await ico.open(12345, price1);
      await buyTokens1(partner1, 123);
      expect(await currencyToken.balanceOf(icoAddress)).to.equal(getPrice1(123));
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(0);
      expect(await token.balanceOf(icoAddress)).to.equal(totalSupply);
      expect(await ico.tokensForSale()).to.equal(12345);
      expect(await ico.tokensSold()).to.equal(123);
      expect(await ico.balanceOf(owner)).to.equal(0);
      expect(await ico.balanceOf(partner1)).to.equal(123);
      expect(await ico.balanceOf(partner2)).to.equal(0);
    });

    it('partner 2 buys', async () => {
      await ico.open(12345, price1);
      await buyTokens1(partner2, 321);
      expect(await currencyToken.balanceOf(icoAddress)).to.equal(getPrice1(321));
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(0);
      expect(await token.balanceOf(icoAddress)).to.equal(totalSupply);
      expect(await ico.tokensForSale()).to.equal(12345);
      expect(await ico.tokensSold()).to.equal(321);
      expect(await ico.balanceOf(owner)).to.equal(0);
      expect(await ico.balanceOf(partner1)).to.equal(0);
      expect(await ico.balanceOf(partner2)).to.equal(321);
    });

    it('both buy', async () => {
      await ico.open(12345, price1);
      await buyTokens1(partner1, 321);
      await buyTokens1(partner2, 123);
      expect(await currencyToken.balanceOf(icoAddress)).to.equal(getPrice1(321) + getPrice1(123));
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(0);
      expect(await token.balanceOf(icoAddress)).to.equal(totalSupply);
      expect(await ico.tokensForSale()).to.equal(12345);
      expect(await ico.tokensSold()).to.equal(123 + 321);
      expect(await ico.balanceOf(owner)).to.equal(0);
      expect(await ico.balanceOf(partner1)).to.equal(321);
      expect(await ico.balanceOf(partner2)).to.equal(123);
    });

    it('buy twice', async () => {
      await ico.open(12345, price1);
      await buyTokens1(partner1, 123);
      await buyTokens1(partner1, 321);
      expect(await currencyToken.balanceOf(icoAddress)).to.equal(getPrice1(123) + getPrice1(321));
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(0);
      expect(await token.balanceOf(icoAddress)).to.equal(totalSupply);
      expect(await ico.tokensForSale()).to.equal(12345);
      expect(await ico.tokensSold()).to.equal(123 + 321);
      expect(await ico.balanceOf(owner)).to.equal(0);
      expect(await ico.balanceOf(partner1)).to.equal(123 + 321);
      expect(await ico.balanceOf(partner2)).to.equal(0);
    });

    it('buy too many', async () => {
      await ico.open(1234, price1);
      await expect(buyTokens1(partner1, 12345)).to.be.reverted;
    });

    it('cannot withdraw while open', async () => {
      await ico.open(12345, price1);
      await buyTokens1(partner1, 1234);
      await expect(ico.connect(partner1).withdraw(123)).to.be.reverted;
    });

    it('close', async () => {
      await ico.open(12345, price1);
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
      await ico.open(12345, price1);
      await buyTokens1(partner1, 123);
      await ico.close();
      const value = getPrice1(123);
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
      await ico.open(12345, price1);
      await buyTokens1(partner1, 321);
      await buyTokens1(partner2, 123);
      await ico.close();
      const value = getPrice1(321) + getPrice1(123);
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
      await ico.open(12345, price1);
      await buyTokens1(partner1, 321);
      await buyTokens1(partner1, 123);
      await buyTokens1(partner2, 456);
      await ico.close();
      const value = getPrice1(321) + getPrice1(123) + getPrice1(456);
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
      await ico.open(12345, price1);
      await buyTokens1(partner1, 123);
      await ico.close();
      await ico.connect(partner1).withdraw(12);
      const value = getPrice1(123);
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
      await ico.open(12345, price1);
      await buyTokens1(partner1, 123);
      await buyTokens1(partner1, 321);
      await ico.close();
      await ico.connect(partner1).withdraw(200);
      const value = getPrice1(123) + getPrice1(321);
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
      await ico.open(12345, price1);
      await buyTokens1(partner1, 123);
      await buyTokens1(partner1, 321);
      await buyTokens1(partner2, 456);
      await buyTokens1(partner2, 654);
      await ico.close();
      await ico.connect(partner1).withdraw(300);
      await ico.connect(partner2).withdraw(500);
      const value = getPrice1(123) + getPrice1(321) + getPrice1(456) + getPrice1(654);
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
      await ico.open(12345, price1);
      await buyTokens1(partner1, 123);
      await buyTokens1(partner1, 321);
      await buyTokens1(partner2, 456);
      await buyTokens1(partner2, 654);
      await ico.close();
      await expect(ico.connect(partner1).withdraw(1000)).to.be.reverted;
    });

    it('withdraw all', async () => {
      await ico.open(12345, price1);
      await buyTokens1(partner1, 123);
      await buyTokens1(partner1, 321);
      await ico.close();
      await ico.connect(partner1).withdrawAll();
      const value = getPrice1(123) + getPrice1(321);
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
      await ico.open(12345, price1);
      await ico.close();
      await expect(ico.connect(partner1).withdrawAll()).to.be.reverted;
    });
  });

  describe('second round', () => {
    beforeEach(async () => {
      await ico.open(12345, price1);
      await buyTokens2(partner1, 123);
      await buyTokens2(partner2, 321);
      await ico.close();
      await ico.connect(partner1).withdraw(100);
      await ico.connect(partner2).withdraw(100);
      await ico.open(54321, price2);
    });

    it('open', async () => {
      expect(await currencyToken.balanceOf(icoAddress)).to.equal(0);
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(
        getPrice1(123) + getPrice1(321),
      );
      expect(await token.balanceOf(icoAddress)).to.equal(totalSupply - 200n);
      expect(await ico.tokensForSale()).to.equal(54321);
      expect(await ico.tokensSold()).to.equal(0);
      expect(await ico.price()).to.equal(price2);
      expect(await ico.isOpen()).to.equal(true);
      expect(await ico.balanceOf(owner)).to.equal(0);
      expect(await ico.balanceOf(partner1)).to.equal(23);
      expect(await ico.balanceOf(partner2)).to.equal(221);
    });

    it('partner 1 buys', async () => {
      await buyTokens2(partner1, 123);
      expect(await currencyToken.balanceOf(icoAddress)).to.equal(getPrice2(123));
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(
        getPrice1(123) + getPrice1(321),
      );
      expect(await token.balanceOf(icoAddress)).to.equal(totalSupply - 200n);
      expect(await ico.tokensForSale()).to.equal(54321);
      expect(await ico.tokensSold()).to.equal(123);
      expect(await ico.balanceOf(owner)).to.equal(0);
      expect(await ico.balanceOf(partner1)).to.equal(146);
      expect(await ico.balanceOf(partner2)).to.equal(221);
    });

    it('partner 2 buys', async () => {
      await buyTokens2(partner2, 321);
      expect(await currencyToken.balanceOf(icoAddress)).to.equal(getPrice2(321));
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(
        getPrice1(123) + getPrice1(321),
      );
      expect(await token.balanceOf(icoAddress)).to.equal(totalSupply - 200n);
      expect(await ico.tokensForSale()).to.equal(54321);
      expect(await ico.tokensSold()).to.equal(321);
      expect(await ico.balanceOf(owner)).to.equal(0);
      expect(await ico.balanceOf(partner1)).to.equal(23);
      expect(await ico.balanceOf(partner2)).to.equal(542);
    });

    it('both buy', async () => {
      await buyTokens2(partner1, 321);
      await buyTokens2(partner2, 123);
      expect(await currencyToken.balanceOf(icoAddress)).to.equal(getPrice2(321) + getPrice2(123));
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(
        getPrice1(123) + getPrice1(321),
      );
      expect(await token.balanceOf(icoAddress)).to.equal(totalSupply - 200n);
      expect(await ico.tokensForSale()).to.equal(54321);
      expect(await ico.tokensSold()).to.equal(123 + 321);
      expect(await ico.balanceOf(owner)).to.equal(0);
      expect(await ico.balanceOf(partner1)).to.equal(344);
      expect(await ico.balanceOf(partner2)).to.equal(344);
    });

    it('buy twice', async () => {
      await buyTokens2(partner1, 123);
      await buyTokens2(partner1, 321);
      expect(await currencyToken.balanceOf(icoAddress)).to.equal(getPrice2(123) + getPrice2(321));
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(
        getPrice1(123) + getPrice1(321),
      );
      expect(await token.balanceOf(icoAddress)).to.equal(totalSupply - 200n);
      expect(await ico.tokensForSale()).to.equal(54321);
      expect(await ico.tokensSold()).to.equal(123 + 321);
      expect(await ico.balanceOf(owner)).to.equal(0);
      expect(await ico.balanceOf(partner1)).to.equal(467);
      expect(await ico.balanceOf(partner2)).to.equal(221);
    });

    it('buy too many', async () => {
      await expect(buyTokens2(partner1, 654321)).to.be.reverted;
    });

    it('cannot withdraw while open', async () => {
      await buyTokens2(partner1, 1234);
      await expect(ico.connect(partner1).withdraw(123)).to.be.reverted;
    });

    it('close', async () => {
      await ico.close();
      expect(await currencyToken.balanceOf(icoAddress)).to.equal(0);
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(
        getPrice1(123) + getPrice1(321),
      );
      expect(await token.balanceOf(icoAddress)).to.equal(totalSupply - 200n);
      expect(await ico.tokensForSale()).to.equal(54321);
      expect(await ico.tokensSold()).to.equal(0);
      expect(await ico.isOpen()).to.equal(false);
      expect(await ico.balanceOf(owner)).to.equal(0);
      expect(await ico.balanceOf(partner1)).to.equal(23);
      expect(await ico.balanceOf(partner2)).to.equal(221);
    });

    it('buy and close', async () => {
      await buyTokens2(partner1, 123);
      await ico.close();
      const value1 = getPrice1(123) + getPrice1(321);
      const value2 = getPrice2(123);
      const value = value1 + value2;
      const stash = (value1 * 60n) / 248n + (value2 * 60n) / 248n;
      expect(await currencyToken.balanceOf(icoAddress)).to.equal(0);
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(value);
      expect(await lottery.getJackpot()).to.equal(value - stash);
      expect(await lottery.getStash()).to.equal(stash);
      expect(await token.balanceOf(icoAddress)).to.equal(totalSupply - 200n);
      expect(await ico.tokensForSale()).to.equal(54321);
      expect(await ico.tokensSold()).to.equal(123);
      expect(await ico.isOpen()).to.equal(false);
      expect(await ico.balanceOf(owner)).to.equal(0);
      expect(await ico.balanceOf(partner1)).to.equal(146);
      expect(await ico.balanceOf(partner2)).to.equal(221);
    });

    // TODO
  });
});
