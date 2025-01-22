import { expect } from 'chai';

import { ethers } from 'hardhat';
import type { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers';
import { takeSnapshot, time } from '@nomicfoundation/hardhat-network-helpers';

import type { Signer, TypedDataDomain } from 'ethers';
import type { FakeToken, Lottery, LotteryTokenSale, LotteryToken } from '../typechain-types';

import { Deployer } from '../scripts/deployer';

const ONE_HOUR = 60 * 60;

describe('TokenSale', () => {
  const deployer = new Deployer();

  let owner: Signer;
  let partner1: Signer;
  let partner2: Signer;

  let snapshot: SnapshotRestorer;

  let currencyToken: FakeToken;
  let token: LotteryToken;
  let lottery: Lottery;
  let lotteryAddress: string;
  let tokenSale: LotteryTokenSale;
  let tokenSaleAddress: string;

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
    ({ token, lottery, tokenSale } = await deployer.deployAll(
      currencyTokenAddress,
      vrfCoordinatorAddress,
    ));
    [lotteryAddress, tokenSaleAddress] = await Promise.all([
      lottery.getAddress(),
      tokenSale.getAddress(),
    ]);
    totalSupply = await token.totalSupply();
    await token.transfer(tokenSaleAddress, totalSupply);
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
    await currencyToken.connect(signer).approve(tokenSaleAddress, price);
    await tokenSale.connect(signer).purchase(amount);
  };

  const buyTokens1 = async (signer: Signer, amount: number | bigint) =>
    buyTokensAtPrice(signer, amount, getPrice1(amount));

  const buyTokens2 = async (signer: Signer, amount: number | bigint) =>
    buyTokensAtPrice(signer, amount, getPrice2(amount));

  const signPermit = async (signer: Signer, value: bigint) => {
    const domain: TypedDataDomain = {
      chainId: 31337,
      name: await currencyToken.name(),
      verifyingContract: await currencyToken.getAddress(),
      version: '1',
    };
    const deadline = (await time.latest()) + ONE_HOUR;
    const ownerAddress = await signer.getAddress();
    const message = {
      owner: ownerAddress,
      spender: tokenSaleAddress,
      value,
      nonce: await currencyToken.nonces(ownerAddress),
      deadline,
    };
    const types = {
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    };
    const signature = await signer.signTypedData(domain, types, message);
    const { r, s, v } = ethers.Signature.from(signature);
    return { r, s, v, deadline };
  };

  it('initial state', async () => {
    expect(await currencyToken.balanceOf(tokenSaleAddress)).to.equal(0);
    expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(0);
    expect(await token.balanceOf(tokenSaleAddress)).to.equal(totalSupply);
    expect(await tokenSale.currencyToken()).to.equal(await currencyToken.getAddress());
    expect(await tokenSale.token()).to.equal(await token.getAddress());
    expect(await tokenSale.lottery()).to.equal(await lottery.getAddress());
    expect(await tokenSale.tokensForSale()).to.equal(0);
    expect(await tokenSale.tokensSold()).to.equal(0);
    expect(await tokenSale.isOpen()).to.equal(false);
    expect(await tokenSale.balanceOf(owner)).to.equal(0);
    expect(await tokenSale.balanceOf(partner1)).to.equal(0);
    expect(await tokenSale.balanceOf(partner2)).to.equal(0);
    await expect(buyTokens1(partner1, 1)).to.be.reverted;
    await expect(buyTokens1(partner2, 1)).to.be.reverted;
  });

  describe('first round', () => {
    it('open', async () => {
      await tokenSale.open(12345, price1);
      expect(await currencyToken.balanceOf(tokenSaleAddress)).to.equal(0);
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(0);
      expect(await token.balanceOf(tokenSaleAddress)).to.equal(totalSupply);
      expect(await tokenSale.tokensForSale()).to.equal(12345);
      expect(await tokenSale.tokensSold()).to.equal(0);
      expect(await tokenSale.price()).to.equal(price1);
      expect(await tokenSale.isOpen()).to.equal(true);
      expect(await tokenSale.balanceOf(owner)).to.equal(0);
      expect(await tokenSale.balanceOf(partner1)).to.equal(0);
      expect(await tokenSale.balanceOf(partner2)).to.equal(0);
    });

    it('partner 1 buys', async () => {
      await tokenSale.open(12345, price1);
      await buyTokens1(partner1, 123);
      expect(await currencyToken.balanceOf(tokenSaleAddress)).to.equal(getPrice1(123));
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(0);
      expect(await token.balanceOf(tokenSaleAddress)).to.equal(totalSupply);
      expect(await tokenSale.tokensForSale()).to.equal(12345);
      expect(await tokenSale.tokensSold()).to.equal(123);
      expect(await tokenSale.price()).to.equal(price1);
      expect(await tokenSale.isOpen()).to.equal(true);
      expect(await tokenSale.balanceOf(owner)).to.equal(0);
      expect(await tokenSale.balanceOf(partner1)).to.equal(123);
      expect(await tokenSale.balanceOf(partner2)).to.equal(0);
    });

    it('partner 2 buys', async () => {
      await tokenSale.open(12345, price1);
      await buyTokens1(partner2, 321);
      expect(await currencyToken.balanceOf(tokenSaleAddress)).to.equal(getPrice1(321));
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(0);
      expect(await token.balanceOf(tokenSaleAddress)).to.equal(totalSupply);
      expect(await tokenSale.tokensForSale()).to.equal(12345);
      expect(await tokenSale.tokensSold()).to.equal(321);
      expect(await tokenSale.price()).to.equal(price1);
      expect(await tokenSale.isOpen()).to.equal(true);
      expect(await tokenSale.balanceOf(owner)).to.equal(0);
      expect(await tokenSale.balanceOf(partner1)).to.equal(0);
      expect(await tokenSale.balanceOf(partner2)).to.equal(321);
    });

    it('both buy', async () => {
      await tokenSale.open(12345, price1);
      await buyTokens1(partner1, 321);
      await buyTokens1(partner2, 123);
      expect(await currencyToken.balanceOf(tokenSaleAddress)).to.equal(
        getPrice1(321) + getPrice1(123),
      );
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(0);
      expect(await token.balanceOf(tokenSaleAddress)).to.equal(totalSupply);
      expect(await tokenSale.tokensForSale()).to.equal(12345);
      expect(await tokenSale.tokensSold()).to.equal(123 + 321);
      expect(await tokenSale.price()).to.equal(price1);
      expect(await tokenSale.isOpen()).to.equal(true);
      expect(await tokenSale.balanceOf(owner)).to.equal(0);
      expect(await tokenSale.balanceOf(partner1)).to.equal(321);
      expect(await tokenSale.balanceOf(partner2)).to.equal(123);
    });

    it('buy twice', async () => {
      await tokenSale.open(12345, price1);
      await buyTokens1(partner1, 123);
      await buyTokens1(partner1, 321);
      expect(await currencyToken.balanceOf(tokenSaleAddress)).to.equal(
        getPrice1(123) + getPrice1(321),
      );
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(0);
      expect(await token.balanceOf(tokenSaleAddress)).to.equal(totalSupply);
      expect(await tokenSale.tokensForSale()).to.equal(12345);
      expect(await tokenSale.tokensSold()).to.equal(123 + 321);
      expect(await tokenSale.price()).to.equal(price1);
      expect(await tokenSale.isOpen()).to.equal(true);
      expect(await tokenSale.balanceOf(owner)).to.equal(0);
      expect(await tokenSale.balanceOf(partner1)).to.equal(123 + 321);
      expect(await tokenSale.balanceOf(partner2)).to.equal(0);
    });

    it('buy too many', async () => {
      await tokenSale.open(1234, price1);
      await expect(buyTokens1(partner1, 12345)).to.be.reverted;
    });

    it('cannot withdraw while open', async () => {
      await tokenSale.open(12345, price1);
      await buyTokens1(partner1, 1234);
      await expect(tokenSale.connect(partner1).withdraw(123)).to.be.reverted;
    });

    it('close', async () => {
      await tokenSale.open(12345, price1);
      await tokenSale.close();
      expect(await currencyToken.balanceOf(tokenSaleAddress)).to.equal(0);
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(0);
      expect(await token.balanceOf(tokenSaleAddress)).to.equal(totalSupply);
      expect(await tokenSale.tokensForSale()).to.equal(12345);
      expect(await tokenSale.tokensSold()).to.equal(0);
      expect(await tokenSale.isOpen()).to.equal(false);
      expect(await tokenSale.balanceOf(owner)).to.equal(0);
      expect(await tokenSale.balanceOf(partner1)).to.equal(0);
      expect(await tokenSale.balanceOf(partner2)).to.equal(0);
    });

    it('buy and close', async () => {
      await tokenSale.open(12345, price1);
      await buyTokens1(partner1, 123);
      await tokenSale.close();
      const value = getPrice1(123);
      const stash = (value * 60n) / 248n;
      expect(await currencyToken.balanceOf(tokenSaleAddress)).to.equal(0);
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(value);
      expect(await lottery.getJackpot()).to.equal(value - stash);
      expect(await lottery.getStash()).to.equal(stash);
      expect(await token.balanceOf(tokenSaleAddress)).to.equal(totalSupply);
      expect(await tokenSale.tokensForSale()).to.equal(12345);
      expect(await tokenSale.tokensSold()).to.equal(123);
      expect(await tokenSale.isOpen()).to.equal(false);
      expect(await tokenSale.balanceOf(owner)).to.equal(0);
      expect(await tokenSale.balanceOf(partner1)).to.equal(123);
      expect(await tokenSale.balanceOf(partner2)).to.equal(0);
    });

    it('both buy and close', async () => {
      await tokenSale.open(12345, price1);
      await buyTokens1(partner1, 321);
      await buyTokens1(partner2, 123);
      await tokenSale.close();
      const value = getPrice1(321) + getPrice1(123);
      const stash = (value * 60n) / 248n;
      expect(await currencyToken.balanceOf(tokenSaleAddress)).to.equal(0);
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(value);
      expect(await lottery.getJackpot()).to.equal(value - stash);
      expect(await lottery.getStash()).to.equal(stash);
      expect(await token.balanceOf(tokenSaleAddress)).to.equal(totalSupply);
      expect(await tokenSale.tokensForSale()).to.equal(12345);
      expect(await tokenSale.tokensSold()).to.equal(321 + 123);
      expect(await tokenSale.isOpen()).to.equal(false);
      expect(await tokenSale.balanceOf(owner)).to.equal(0);
      expect(await tokenSale.balanceOf(partner1)).to.equal(321);
      expect(await tokenSale.balanceOf(partner2)).to.equal(123);
    });

    it('buy many and close', async () => {
      await tokenSale.open(12345, price1);
      await buyTokens1(partner1, 321);
      await buyTokens1(partner1, 123);
      await buyTokens1(partner2, 456);
      await tokenSale.close();
      const value = getPrice1(321) + getPrice1(123) + getPrice1(456);
      const stash = (value * 60n) / 248n;
      expect(await currencyToken.balanceOf(tokenSaleAddress)).to.equal(0);
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(value);
      expect(await lottery.getJackpot()).to.equal(value - stash);
      expect(await lottery.getStash()).to.equal(stash);
      expect(await token.balanceOf(tokenSaleAddress)).to.equal(totalSupply);
      expect(await tokenSale.tokensForSale()).to.equal(12345);
      expect(await tokenSale.tokensSold()).to.equal(321 + 123 + 456);
      expect(await tokenSale.isOpen()).to.equal(false);
      expect(await tokenSale.balanceOf(owner)).to.equal(0);
      expect(await tokenSale.balanceOf(partner1)).to.equal(321 + 123);
      expect(await tokenSale.balanceOf(partner2)).to.equal(456);
    });

    it('withdraw', async () => {
      await tokenSale.open(12345, price1);
      await buyTokens1(partner1, 123);
      await tokenSale.close();
      await tokenSale.connect(partner1).withdraw(12);
      const value = getPrice1(123);
      const stash = (value * 60n) / 248n;
      expect(await currencyToken.balanceOf(tokenSaleAddress)).to.equal(0);
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(value);
      expect(await lottery.getJackpot()).to.equal(value - stash);
      expect(await lottery.getStash()).to.equal(stash);
      expect(await token.balanceOf(tokenSaleAddress)).to.equal(totalSupply - 12n);
      expect(await token.balanceOf(owner)).to.equal(0);
      expect(await token.balanceOf(partner1)).to.equal(12);
      expect(await token.balanceOf(partner2)).to.equal(0);
      expect(await tokenSale.isOpen()).to.equal(false);
      expect(await tokenSale.balanceOf(owner)).to.equal(0);
      expect(await tokenSale.balanceOf(partner1)).to.equal(123 - 12);
      expect(await tokenSale.balanceOf(partner2)).to.equal(0);
    });

    it('liquid withdrawal', async () => {
      await tokenSale.open(12345, price1);
      await buyTokens1(partner1, 123);
      await buyTokens1(partner1, 321);
      await tokenSale.close();
      await tokenSale.connect(partner1).withdraw(200);
      const value = getPrice1(123) + getPrice1(321);
      const stash = (value * 60n) / 248n;
      expect(await currencyToken.balanceOf(tokenSaleAddress)).to.equal(0);
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(value);
      expect(await lottery.getJackpot()).to.equal(value - stash);
      expect(await lottery.getStash()).to.equal(stash);
      expect(await token.balanceOf(tokenSaleAddress)).to.equal(totalSupply - 200n);
      expect(await token.balanceOf(owner)).to.equal(0);
      expect(await token.balanceOf(partner1)).to.equal(200);
      expect(await token.balanceOf(partner2)).to.equal(0);
      expect(await tokenSale.isOpen()).to.equal(false);
      expect(await tokenSale.balanceOf(owner)).to.equal(0);
      expect(await tokenSale.balanceOf(partner1)).to.equal(244);
      expect(await tokenSale.balanceOf(partner2)).to.equal(0);
    });

    it('both withdraw', async () => {
      await tokenSale.open(12345, price1);
      await buyTokens1(partner1, 123);
      await buyTokens1(partner1, 321);
      await buyTokens1(partner2, 456);
      await buyTokens1(partner2, 654);
      await tokenSale.close();
      await tokenSale.connect(partner1).withdraw(300);
      await tokenSale.connect(partner2).withdraw(500);
      const value = getPrice1(123) + getPrice1(321) + getPrice1(456) + getPrice1(654);
      const stash = (value * 60n) / 248n;
      expect(await currencyToken.balanceOf(tokenSaleAddress)).to.equal(0);
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(value);
      expect(await lottery.getJackpot()).to.equal(value - stash);
      expect(await lottery.getStash()).to.equal(stash);
      expect(await token.balanceOf(tokenSaleAddress)).to.equal(totalSupply - 800n);
      expect(await token.balanceOf(owner)).to.equal(0);
      expect(await token.balanceOf(partner1)).to.equal(300);
      expect(await token.balanceOf(partner2)).to.equal(500);
      expect(await tokenSale.isOpen()).to.equal(false);
      expect(await tokenSale.balanceOf(owner)).to.equal(0);
      expect(await tokenSale.balanceOf(partner1)).to.equal(144);
      expect(await tokenSale.balanceOf(partner2)).to.equal(610);
    });

    it('cannot withdraw more than balance', async () => {
      await tokenSale.open(12345, price1);
      await buyTokens1(partner1, 123);
      await buyTokens1(partner1, 321);
      await buyTokens1(partner2, 456);
      await buyTokens1(partner2, 654);
      await tokenSale.close();
      await expect(tokenSale.connect(partner1).withdraw(1000)).to.be.reverted;
    });

    it('withdraw all', async () => {
      await tokenSale.open(12345, price1);
      await buyTokens1(partner1, 123);
      await buyTokens1(partner1, 321);
      await tokenSale.close();
      await tokenSale.connect(partner1).withdrawAll();
      const value = getPrice1(123) + getPrice1(321);
      const stash = (value * 60n) / 248n;
      expect(await currencyToken.balanceOf(tokenSaleAddress)).to.equal(0);
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(value);
      expect(await lottery.getJackpot()).to.equal(value - stash);
      expect(await lottery.getStash()).to.equal(stash);
      expect(await token.balanceOf(tokenSaleAddress)).to.equal(totalSupply - 444n);
      expect(await token.balanceOf(owner)).to.equal(0);
      expect(await token.balanceOf(partner1)).to.equal(444);
      expect(await token.balanceOf(partner2)).to.equal(0);
      expect(await tokenSale.isOpen()).to.equal(false);
      expect(await tokenSale.balanceOf(owner)).to.equal(0);
      expect(await tokenSale.balanceOf(partner1)).to.equal(0);
      expect(await tokenSale.balanceOf(partner2)).to.equal(0);
    });

    it('withdraw nothing', async () => {
      await tokenSale.open(12345, price1);
      await tokenSale.close();
      await expect(tokenSale.connect(partner1).withdrawAll()).to.be.reverted;
    });
  });

  describe('second round', () => {
    beforeEach(async () => {
      await tokenSale.open(12345, price1);
      await buyTokens1(partner1, 123);
      await buyTokens1(partner2, 321);
      await tokenSale.close();
      await tokenSale.connect(partner1).withdraw(100);
      await tokenSale.connect(partner2).withdraw(100);
      await tokenSale.open(54321, price2);
    });

    it('open', async () => {
      expect(await currencyToken.balanceOf(tokenSaleAddress)).to.equal(0);
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(
        getPrice1(123) + getPrice1(321),
      );
      expect(await token.balanceOf(tokenSaleAddress)).to.equal(totalSupply - 200n);
      expect(await tokenSale.tokensForSale()).to.equal(54321);
      expect(await tokenSale.tokensSold()).to.equal(0);
      expect(await tokenSale.price()).to.equal(price2);
      expect(await tokenSale.isOpen()).to.equal(true);
      expect(await tokenSale.balanceOf(owner)).to.equal(0);
      expect(await tokenSale.balanceOf(partner1)).to.equal(23);
      expect(await tokenSale.balanceOf(partner2)).to.equal(221);
    });

    it('partner 1 buys', async () => {
      await buyTokens2(partner1, 123);
      expect(await currencyToken.balanceOf(tokenSaleAddress)).to.equal(getPrice2(123));
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(
        getPrice1(123) + getPrice1(321),
      );
      expect(await token.balanceOf(tokenSaleAddress)).to.equal(totalSupply - 200n);
      expect(await tokenSale.tokensForSale()).to.equal(54321);
      expect(await tokenSale.tokensSold()).to.equal(123);
      expect(await tokenSale.price()).to.equal(price2);
      expect(await tokenSale.isOpen()).to.equal(true);
      expect(await tokenSale.balanceOf(owner)).to.equal(0);
      expect(await tokenSale.balanceOf(partner1)).to.equal(146);
      expect(await tokenSale.balanceOf(partner2)).to.equal(221);
    });

    it('partner 2 buys', async () => {
      await buyTokens2(partner2, 321);
      expect(await currencyToken.balanceOf(tokenSaleAddress)).to.equal(getPrice2(321));
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(
        getPrice1(123) + getPrice1(321),
      );
      expect(await token.balanceOf(tokenSaleAddress)).to.equal(totalSupply - 200n);
      expect(await tokenSale.tokensForSale()).to.equal(54321);
      expect(await tokenSale.tokensSold()).to.equal(321);
      expect(await tokenSale.price()).to.equal(price2);
      expect(await tokenSale.isOpen()).to.equal(true);
      expect(await tokenSale.balanceOf(owner)).to.equal(0);
      expect(await tokenSale.balanceOf(partner1)).to.equal(23);
      expect(await tokenSale.balanceOf(partner2)).to.equal(542);
    });

    it('both buy', async () => {
      await buyTokens2(partner1, 321);
      await buyTokens2(partner2, 123);
      expect(await currencyToken.balanceOf(tokenSaleAddress)).to.equal(
        getPrice2(321) + getPrice2(123),
      );
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(
        getPrice1(123) + getPrice1(321),
      );
      expect(await token.balanceOf(tokenSaleAddress)).to.equal(totalSupply - 200n);
      expect(await tokenSale.tokensForSale()).to.equal(54321);
      expect(await tokenSale.tokensSold()).to.equal(123 + 321);
      expect(await tokenSale.price()).to.equal(price2);
      expect(await tokenSale.isOpen()).to.equal(true);
      expect(await tokenSale.balanceOf(owner)).to.equal(0);
      expect(await tokenSale.balanceOf(partner1)).to.equal(344);
      expect(await tokenSale.balanceOf(partner2)).to.equal(344);
    });

    it('buy twice', async () => {
      await buyTokens2(partner1, 123);
      await buyTokens2(partner1, 321);
      expect(await currencyToken.balanceOf(tokenSaleAddress)).to.equal(
        getPrice2(123) + getPrice2(321),
      );
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(
        getPrice1(123) + getPrice1(321),
      );
      expect(await token.balanceOf(tokenSaleAddress)).to.equal(totalSupply - 200n);
      expect(await tokenSale.tokensForSale()).to.equal(54321);
      expect(await tokenSale.tokensSold()).to.equal(123 + 321);
      expect(await tokenSale.price()).to.equal(price2);
      expect(await tokenSale.isOpen()).to.equal(true);
      expect(await tokenSale.balanceOf(owner)).to.equal(0);
      expect(await tokenSale.balanceOf(partner1)).to.equal(467);
      expect(await tokenSale.balanceOf(partner2)).to.equal(221);
    });

    it('buy too many', async () => {
      await expect(buyTokens2(partner1, 654321)).to.be.reverted;
    });

    it('cannot withdraw while open', async () => {
      await buyTokens2(partner1, 1234);
      await expect(tokenSale.connect(partner1).withdraw(123)).to.be.reverted;
    });

    it('close', async () => {
      await tokenSale.close();
      expect(await currencyToken.balanceOf(tokenSaleAddress)).to.equal(0);
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(
        getPrice1(123) + getPrice1(321),
      );
      expect(await token.balanceOf(tokenSaleAddress)).to.equal(totalSupply - 200n);
      expect(await tokenSale.tokensForSale()).to.equal(54321);
      expect(await tokenSale.tokensSold()).to.equal(0);
      expect(await tokenSale.isOpen()).to.equal(false);
      expect(await tokenSale.balanceOf(owner)).to.equal(0);
      expect(await tokenSale.balanceOf(partner1)).to.equal(23);
      expect(await tokenSale.balanceOf(partner2)).to.equal(221);
    });

    it('buy and close', async () => {
      await buyTokens2(partner1, 123);
      await tokenSale.close();
      const value1 = getPrice1(123) + getPrice1(321);
      const value2 = getPrice2(123);
      const value = value1 + value2;
      const stash = (value1 * 60n) / 248n + (value2 * 60n) / 248n;
      expect(await currencyToken.balanceOf(tokenSaleAddress)).to.equal(0);
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(value);
      expect(await lottery.getJackpot()).to.equal(value - stash);
      expect(await lottery.getStash()).to.equal(stash);
      expect(await token.balanceOf(tokenSaleAddress)).to.equal(totalSupply - 200n);
      expect(await tokenSale.tokensForSale()).to.equal(54321);
      expect(await tokenSale.tokensSold()).to.equal(123);
      expect(await tokenSale.isOpen()).to.equal(false);
      expect(await tokenSale.balanceOf(owner)).to.equal(0);
      expect(await tokenSale.balanceOf(partner1)).to.equal(146);
      expect(await tokenSale.balanceOf(partner2)).to.equal(221);
    });

    it('both buy and close', async () => {
      await buyTokens2(partner1, 321);
      await buyTokens2(partner2, 123);
      await tokenSale.close();
      const value1 = getPrice1(123) + getPrice1(321);
      const value2 = getPrice2(321) + getPrice2(123);
      const value = value1 + value2;
      const stash = (value1 * 60n) / 248n + (value2 * 60n) / 248n;
      expect(await currencyToken.balanceOf(tokenSaleAddress)).to.equal(0);
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(value);
      expect(await lottery.getJackpot()).to.equal(value - stash);
      expect(await lottery.getStash()).to.equal(stash);
      expect(await token.balanceOf(tokenSaleAddress)).to.equal(totalSupply - 200n);
      expect(await tokenSale.tokensForSale()).to.equal(54321);
      expect(await tokenSale.tokensSold()).to.equal(321 + 123);
      expect(await tokenSale.isOpen()).to.equal(false);
      expect(await tokenSale.balanceOf(owner)).to.equal(0);
      expect(await tokenSale.balanceOf(partner1)).to.equal(344);
      expect(await tokenSale.balanceOf(partner2)).to.equal(344);
    });

    it('buy many and close', async () => {
      await buyTokens2(partner1, 321);
      await buyTokens2(partner1, 123);
      await buyTokens2(partner2, 456);
      await tokenSale.close();
      const value1 = getPrice1(123) + getPrice1(321);
      const value2 = getPrice2(321) + getPrice2(123) + getPrice2(456);
      const value = value1 + value2;
      const stash = (value1 * 60n) / 248n + (value2 * 60n) / 248n;
      expect(await currencyToken.balanceOf(tokenSaleAddress)).to.equal(0);
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(value);
      expect(await lottery.getJackpot()).to.equal(value - stash);
      expect(await lottery.getStash()).to.equal(stash);
      expect(await token.balanceOf(tokenSaleAddress)).to.equal(totalSupply - 200n);
      expect(await tokenSale.tokensForSale()).to.equal(54321);
      expect(await tokenSale.tokensSold()).to.equal(321 + 123 + 456);
      expect(await tokenSale.isOpen()).to.equal(false);
      expect(await tokenSale.balanceOf(owner)).to.equal(0);
      expect(await tokenSale.balanceOf(partner1)).to.equal(467);
      expect(await tokenSale.balanceOf(partner2)).to.equal(677);
    });

    it('withdraw', async () => {
      await buyTokens2(partner1, 123);
      await tokenSale.close();
      await tokenSale.connect(partner1).withdraw(12);
      const value1 = getPrice1(123) + getPrice1(321);
      const value2 = getPrice2(123);
      const value = value1 + value2;
      const stash = (value1 * 60n) / 248n + (value2 * 60n) / 248n;
      expect(await currencyToken.balanceOf(tokenSaleAddress)).to.equal(0);
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(value);
      expect(await lottery.getJackpot()).to.equal(value - stash);
      expect(await lottery.getStash()).to.equal(stash);
      expect(await token.balanceOf(tokenSaleAddress)).to.equal(totalSupply - 212n);
      expect(await token.balanceOf(owner)).to.equal(0);
      expect(await token.balanceOf(partner1)).to.equal(112);
      expect(await token.balanceOf(partner2)).to.equal(100);
      expect(await tokenSale.isOpen()).to.equal(false);
      expect(await tokenSale.balanceOf(owner)).to.equal(0);
      expect(await tokenSale.balanceOf(partner1)).to.equal(134);
      expect(await tokenSale.balanceOf(partner2)).to.equal(221);
    });

    it('liquid withdrawal', async () => {
      await buyTokens2(partner1, 123);
      await buyTokens2(partner1, 321);
      await tokenSale.close();
      await tokenSale.connect(partner1).withdraw(200);
      const value1 = getPrice1(123) + getPrice1(321);
      const value2 = getPrice2(123) + getPrice2(321);
      const value = value1 + value2;
      const stash = (value1 * 60n) / 248n + (value2 * 60n) / 248n;
      expect(await currencyToken.balanceOf(tokenSaleAddress)).to.equal(0);
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(value);
      expect(await lottery.getJackpot()).to.equal(value - stash);
      expect(await lottery.getStash()).to.equal(stash);
      expect(await token.balanceOf(tokenSaleAddress)).to.equal(totalSupply - 400n);
      expect(await token.balanceOf(owner)).to.equal(0);
      expect(await token.balanceOf(partner1)).to.equal(300);
      expect(await token.balanceOf(partner2)).to.equal(100);
      expect(await tokenSale.isOpen()).to.equal(false);
      expect(await tokenSale.balanceOf(owner)).to.equal(0);
      expect(await tokenSale.balanceOf(partner1)).to.equal(267);
      expect(await tokenSale.balanceOf(partner2)).to.equal(221);
    });

    it('both withdraw', async () => {
      await buyTokens2(partner1, 123);
      await buyTokens2(partner1, 321);
      await buyTokens2(partner2, 456);
      await buyTokens2(partner2, 654);
      await tokenSale.close();
      await tokenSale.connect(partner1).withdraw(300);
      await tokenSale.connect(partner2).withdraw(500);
      const value1 = getPrice1(123) + getPrice1(321);
      const value2 = getPrice2(123) + getPrice2(321) + getPrice2(456) + getPrice2(654);
      const value = value1 + value2;
      const stash = (value1 * 60n) / 248n + (value2 * 60n) / 248n;
      expect(await currencyToken.balanceOf(tokenSaleAddress)).to.equal(0);
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(value);
      expect(await lottery.getJackpot()).to.equal(value - stash);
      expect(await lottery.getStash()).to.equal(stash);
      expect(await token.balanceOf(tokenSaleAddress)).to.equal(totalSupply - 1000n);
      expect(await token.balanceOf(owner)).to.equal(0);
      expect(await token.balanceOf(partner1)).to.equal(400);
      expect(await token.balanceOf(partner2)).to.equal(600);
      expect(await tokenSale.isOpen()).to.equal(false);
      expect(await tokenSale.balanceOf(owner)).to.equal(0);
      expect(await tokenSale.balanceOf(partner1)).to.equal(167);
      expect(await tokenSale.balanceOf(partner2)).to.equal(831);
    });

    it('cannot withdraw more than balance', async () => {
      await buyTokens2(partner1, 123);
      await buyTokens2(partner1, 321);
      await buyTokens2(partner2, 456);
      await buyTokens2(partner2, 654);
      await tokenSale.close();
      await expect(tokenSale.connect(partner1).withdraw(1000)).to.be.reverted;
    });

    it('withdraw all', async () => {
      await buyTokens2(partner1, 123);
      await buyTokens2(partner1, 321);
      await tokenSale.close();
      await tokenSale.connect(partner1).withdrawAll();
      const value1 = getPrice1(123) + getPrice1(321);
      const value2 = getPrice2(123) + getPrice2(321);
      const value = value1 + value2;
      const stash = (value1 * 60n) / 248n + (value2 * 60n) / 248n;
      expect(await currencyToken.balanceOf(tokenSaleAddress)).to.equal(0);
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(value);
      expect(await lottery.getJackpot()).to.equal(value - stash);
      expect(await lottery.getStash()).to.equal(stash);
      expect(await token.balanceOf(tokenSaleAddress)).to.equal(totalSupply - 667n);
      expect(await token.balanceOf(owner)).to.equal(0);
      expect(await token.balanceOf(partner1)).to.equal(567);
      expect(await token.balanceOf(partner2)).to.equal(100);
      expect(await tokenSale.isOpen()).to.equal(false);
      expect(await tokenSale.balanceOf(owner)).to.equal(0);
      expect(await tokenSale.balanceOf(partner1)).to.equal(0);
      expect(await tokenSale.balanceOf(partner2)).to.equal(221);
    });

    it('withdraw nothing', async () => {
      await tokenSale.close();
      await tokenSale.connect(partner1).withdrawAll();
      await expect(tokenSale.connect(partner1).withdrawAll()).to.be.reverted;
    });
  });

  it('buy with signature', async () => {
    await tokenSale.open(12345, price1);
    const price = getPrice1(123);
    await currencyToken.connect(partner1).mint(price);
    const { deadline, v, r, s } = await signPermit(partner1, price);
    await tokenSale.connect(partner1).purchaseWithPermit(123, deadline, v, r, s);
    expect(await currencyToken.balanceOf(tokenSaleAddress)).to.equal(getPrice1(123));
    expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(0);
    expect(await token.balanceOf(tokenSaleAddress)).to.equal(totalSupply);
    expect(await tokenSale.tokensForSale()).to.equal(12345);
    expect(await tokenSale.tokensSold()).to.equal(123);
    expect(await tokenSale.price()).to.equal(price1);
    expect(await tokenSale.isOpen()).to.equal(true);
    expect(await tokenSale.balanceOf(owner)).to.equal(0);
    expect(await tokenSale.balanceOf(partner1)).to.equal(123);
    expect(await tokenSale.balanceOf(partner2)).to.equal(0);
  });

  it('buy with front-run approval', async () => {
    await tokenSale.open(12345, price1);
    const price = getPrice1(123);
    await currencyToken.connect(partner1).mint(price);
    await currencyToken.connect(partner1).approve(tokenSaleAddress, price);
    const { deadline, v, r, s } = await signPermit(partner1, price);
    await tokenSale.connect(partner1).purchaseWithPermit(123, deadline, v, r, s);
    expect(await currencyToken.balanceOf(tokenSaleAddress)).to.equal(getPrice1(123));
    expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(0);
    expect(await token.balanceOf(tokenSaleAddress)).to.equal(totalSupply);
    expect(await tokenSale.tokensForSale()).to.equal(12345);
    expect(await tokenSale.tokensSold()).to.equal(123);
    expect(await tokenSale.price()).to.equal(price1);
    expect(await tokenSale.isOpen()).to.equal(true);
    expect(await tokenSale.balanceOf(owner)).to.equal(0);
    expect(await tokenSale.balanceOf(partner1)).to.equal(123);
    expect(await tokenSale.balanceOf(partner2)).to.equal(0);
  });
});
