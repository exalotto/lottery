import { expect } from 'chai';

import { ethers } from 'hardhat';
import type { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers';
import { takeSnapshot, time } from '@nomicfoundation/hardhat-network-helpers';

import type { Signer } from 'ethers';
import type { FakeToken, Lottery, MockVRFCoordinator } from '../typechain-types';

import { Deployer } from '../scripts/deployer';
import { advanceTime, advanceTimeToNextDrawing, range } from './utils';

const NULL_REFERRAL_CODE = '0x0000000000000000000000000000000000000000000000000000000000000000';
const REFERRAL_CODE1 = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const REFERRAL_CODE2 = '0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

const ONE_HOUR = 60 * 60;
const THREE_HOURS = 60 * 60 * 3;
const THREE_DAYS = 60 * 60 * 24 * 3;
const ONE_WEEK = 60 * 60 * 24 * 7;

describe('Lottery', () => {
  const deployer = new Deployer();

  let owner: Signer;
  let partner: Signer;
  let player: Signer;

  let currencyToken: FakeToken;
  let vrfCoordinator: MockVRFCoordinator;
  const subscriptionId: number = 1;
  let requestId: number = 1;

  let snapshot: SnapshotRestorer;

  let lotteryAddress: string;
  let lottery: Lottery;

  before(async () => {
    await deployer.init();
    [owner, partner, player] = await ethers.getSigners();
    currencyToken = await deployer.deployFakeTokenForTesting();
    vrfCoordinator = await deployer.deployMockVRFCoordinator();
    await vrfCoordinator.createSubscription();
    const [currencyTokenAddress, vrfCoordinatorAddress] = await Promise.all([
      currencyToken.getAddress(),
      vrfCoordinator.getAddress(),
    ]);
    ({ lottery } = await deployer.deployLottery(currencyTokenAddress, vrfCoordinatorAddress));
    lotteryAddress = await lottery.getAddress();
    await vrfCoordinator.addConsumer(subscriptionId, lotteryAddress);
    await lottery.connect(partner).claimReferralCode(REFERRAL_CODE1, partner);
  });

  beforeEach(async () => {
    snapshot = await takeSnapshot();
    await advanceTimeToNextDrawing();
  });

  afterEach(async () => {
    await snapshot.restore();
    requestId = 1;
  });

  const buyTicketFor = async (
    player: Signer,
    numbers: number[],
    referralCode: string = NULL_REFERRAL_CODE,
  ) => {
    const price = await lottery.connect(player).getTicketPrice(numbers);
    await currencyToken.connect(player).mint(price);
    await currencyToken.connect(player).approve(lotteryAddress, price);
    await lottery.connect(player).createTicket(referralCode, numbers);
    return price;
  };

  const buyTicket = (numbers: number[], referralCode: string = NULL_REFERRAL_CODE) =>
    buyTicketFor(player, numbers, referralCode);

  const draw123456 = async () => {
    await lottery.draw(subscriptionId, process.env.CHAINLINK_VRF_KEY_HASH!);
    await vrfCoordinator.fulfillRandomWordsWithOverride(
      requestId++,
      await lottery.getAddress(),
      [0],
      {
        gasLimit: process.env.EXALOTTO_CALLBACK_GAS_LIMIT,
      },
    );
  };

  it('initial state', async () => {
    expect(await lottery.getBaseTicketPrice()).to.not.equal(0);
    expect(await lottery.getCurrentRound()).to.equal(1);
    expect(await lottery.isOpen()).to.equal(true);
    expect(await lottery.getTotalTicketCount()).to.equal(0);
    expect(await lottery.getPrizes()).to.deep.equal([0, 0, 0, 0, 0]);
    expect(await lottery.getJackpot()).to.equal(0);
    expect(await lottery.getStash()).to.equal(0);
    expect(await lottery.getOwnerRevenue()).to.equal(0);
    expect(await lottery.getPartnerRevenue(NULL_REFERRAL_CODE)).to.equal(0);
    expect(await lottery.getPartnerRevenue(REFERRAL_CODE1)).to.equal(0);
    expect(await lottery.getPartnerRevenue(REFERRAL_CODE2)).to.equal(0);
    expect(await lottery.getTotalRevenue()).to.equal(0);
  });

  describe('referral codes', () => {
    it('unclaimed', async () => {
      expect(await lottery.referralCodesByPartner(partner, 0)).to.equal(REFERRAL_CODE1);
      await expect(lottery.referralCodesByPartner(partner, 1)).to.be.reverted;
    });

    it('cannot claim null', async () => {
      await expect(lottery.connect(partner).claimReferralCode(NULL_REFERRAL_CODE, partner)).to.be
        .reverted;
    });

    it('claim', async () => {
      await lottery.connect(partner).claimReferralCode(REFERRAL_CODE2, partner);
      expect(await lottery.referralCodesByPartner(partner, 0)).to.equal(REFERRAL_CODE1);
      expect(await lottery.referralCodesByPartner(partner, 1)).to.equal(REFERRAL_CODE2);
      await expect(lottery.referralCodesByPartner(partner, 2)).to.be.reverted;
    });

    it('double claim', async () => {
      const partnerLottery = lottery.connect(partner);
      await partnerLottery.claimReferralCode(REFERRAL_CODE2, partner);
      await expect(partnerLottery.claimReferralCode(REFERRAL_CODE2, partner)).to.be.reverted;
    });

    it('cannot claim when paused', async () => {
      await lottery.pause();
      await expect(lottery.connect(partner).claimReferralCode(REFERRAL_CODE2, partner)).to.be
        .reverted;
    });

    it('can claim again when unpaused', async () => {
      await lottery.pause();
      await lottery.unpause();
      await lottery.connect(partner).claimReferralCode(REFERRAL_CODE2, partner);
      expect(await lottery.referralCodesByPartner(partner, 0)).to.equal(REFERRAL_CODE1);
      expect(await lottery.referralCodesByPartner(partner, 1)).to.equal(REFERRAL_CODE2);
      await expect(lottery.referralCodesByPartner(partner, 2)).to.be.reverted;
    });
  });

  describe('getTicketPrice', () => {
    it('0 numbers', async () => {
      await expect(lottery.getTicketPrice([])).to.be.reverted;
    });

    it('5 numbers', async () => {
      await expect(lottery.getTicketPrice([1, 2, 3, 4, 5])).to.be.reverted;
    });

    it('6 numbers', async () => {
      const price = await lottery.getBaseTicketPrice();
      expect(await lottery.getTicketPrice([1, 2, 3, 4, 5, 6])).to.equal(price);
    });

    it('7 numbers', async () => {
      const price = await lottery.getBaseTicketPrice();
      expect(await lottery.getTicketPrice([1, 2, 3, 4, 5, 6, 7])).to.equal(price * 7n);
    });

    it('8 numbers', async () => {
      const price = await lottery.getBaseTicketPrice();
      expect(await lottery.getTicketPrice([1, 2, 3, 4, 5, 6, 7, 8])).to.equal(price * 28n);
    });

    it('duplicate numbers', async () => {
      await expect(lottery.getTicketPrice([1, 2, 3, 1, 2, 3])).to.be.reverted;
    });

    it('out of range numbers', async () => {
      await expect(lottery.getTicketPrice([1, 2, 3, 100, 5, 6])).to.be.reverted;
    });
  });

  describe('getPartnerRevenue', () => {
    it('succeeds on partner fees', async () => {
      expect(await lottery.getPartnerRevenue(REFERRAL_CODE1)).to.equal(0);
    });

    it('picks up ticket fees', async () => {
      const price = await buyTicket([1, 2, 3, 4, 5, 6], REFERRAL_CODE1);
      expect(await lottery.getPartnerRevenue(REFERRAL_CODE1)).to.equal(price / 10n);
    });

    it("doesn't pick up owner fees", async () => {
      await buyTicket([1, 2, 3, 4, 5, 6], NULL_REFERRAL_CODE);
      expect(await lottery.getPartnerRevenue(REFERRAL_CODE1)).to.equal(0);
    });
  });

  describe('value distribution', () => {
    it('1 ticket, w/o referral', async () => {
      const price = await buyTicket([1, 2, 3, 4, 5, 6, 7], NULL_REFERRAL_CODE);
      const value = price - (price / 10n) * 2n;
      expect(await lottery.getPrizes()).to.deep.equal([
        (value * 188n) / 1000n,
        (value * 188n) / 1000n,
        (value * 188n) / 1000n,
        (value * 188n) / 1000n,
        (value * 188n) / 1000n,
      ]);
      expect(await lottery.getJackpot()).to.equal((value * 188n) / 1000n);
      expect(await lottery.getStash()).to.equal(value - ((value * 188n) / 1000n) * 5n);
      expect(await lottery.getOwnerRevenue()).to.equal((price / 10n) * 2n);
      expect(await lottery.getPartnerRevenue(REFERRAL_CODE1)).to.equal(0);
      expect(await lottery.getTotalRevenue()).to.equal((price / 10n) * 2n);
    });

    it('1 ticket, w/ referral', async () => {
      const price = await buyTicket([1, 2, 3, 4, 5, 6, 7], REFERRAL_CODE1);
      const value = price - (price / 10n) * 2n;
      expect(await lottery.getPrizes()).to.deep.equal([
        (value * 188n) / 1000n,
        (value * 188n) / 1000n,
        (value * 188n) / 1000n,
        (value * 188n) / 1000n,
        (value * 188n) / 1000n,
      ]);
      expect(await lottery.getJackpot()).to.equal((value * 188n) / 1000n);
      expect(await lottery.getStash()).to.equal(value - ((value * 188n) / 1000n) * 5n);
      expect(await lottery.getOwnerRevenue()).to.equal(price / 10n);
      expect(await lottery.getPartnerRevenue(REFERRAL_CODE1)).to.equal(price / 10n);
      expect(await lottery.getTotalRevenue()).to.equal((price / 10n) * 2n);
    });

    it('2 tickets', async () => {
      const price = await lottery.getTicketPrice([11, 12, 13, 14, 15, 16, 17]);
      await buyTicket([11, 12, 13, 14, 15, 16, 17], NULL_REFERRAL_CODE);
      await buyTicket([21, 22, 23, 24, 25, 26, 27], REFERRAL_CODE1);
      const value = price * 2n - ((price * 2n) / 10n) * 2n;
      expect(await lottery.getPrizes()).to.deep.equal([
        (value * 188n) / 1000n,
        (value * 188n) / 1000n,
        (value * 188n) / 1000n,
        (value * 188n) / 1000n,
        (value * 188n) / 1000n,
      ]);
      expect(await lottery.getJackpot()).to.equal((value * 188n) / 1000n);
      expect(await lottery.getStash()).to.equal(value - ((value * 188n) / 1000n) * 5n);
      expect(await lottery.getOwnerRevenue()).to.equal((price * 2n) / 10n + price / 10n);
      expect(await lottery.getPartnerRevenue(REFERRAL_CODE1)).to.equal(price / 10n);
      expect(await lottery.getTotalRevenue()).to.equal(((price * 2n) / 10n) * 2n);
    });

    it('funding', async () => {
      await buyTicket([1, 3, 5, 7, 9, 11]);
      await buyTicket([2, 4, 6, 8, 10, 12]);
      const price = await lottery.getBaseTicketPrice();
      const value = price * 2n - ((price * 2n) / 10n) * 2n;
      const prize = (value * 188n) / 1000n;
      const stash1 = value - prize * 5n;
      const funds = 123456n;
      await currencyToken.mint(funds);
      await currencyToken.approve(lotteryAddress, funds);
      await lottery.fund(await owner.getAddress(), funds);
      const stash2 = (funds * 60n) / 248n;
      const jackpot = prize + funds - stash2;
      expect(await lottery.getPrizes()).to.deep.equal([prize, prize, prize, prize, jackpot]);
      expect(await lottery.getJackpot()).to.equal(jackpot);
      expect(await lottery.getStash()).to.equal(stash1 + stash2);
      expect(await lottery.getOwnerRevenue()).to.equal(((price * 2n) / 10n) * 2n);
      expect(await lottery.getPartnerRevenue(NULL_REFERRAL_CODE)).to.equal((price * 2n) / 10n);
      expect(await lottery.getTotalRevenue()).to.equal(((price * 2n) / 10n) * 2n);
    });

    it('next round', async () => {
      await buyTicket([21, 22, 23, 24, 25, 26]);
      await buyTicket([1, 2, 3, 14, 15, 16]);
      await buyTicket([1, 2, 3, 4, 5, 16]);
      const price = await lottery.getBaseTicketPrice();
      const value = price * 3n - ((price * 3n) / 10n) * 2n;
      const prize = (value * 188n) / 1000n;
      const stash = value - prize * 5n;
      await draw123456();
      expect(await lottery.getPrizes()).to.deep.equal([prize, 0n, prize, 0n, prize]);
      expect(await lottery.getJackpot()).to.equal(prize);
      expect(await lottery.getStash()).to.equal(stash);
      expect(await lottery.getOwnerRevenue()).to.equal(0);
      expect(await lottery.getPartnerRevenue(NULL_REFERRAL_CODE)).to.equal(0);
      expect(await lottery.getTotalRevenue()).to.equal(0);
    });

    it('jackpot', async () => {
      await buyTicket([1, 2, 13, 14, 15, 16]);
      await buyTicket([1, 2, 3, 4, 5, 6]);
      await buyTicket([1, 2, 3, 4, 25, 26]);
      const price = await lottery.getBaseTicketPrice();
      const value = price * 3n - ((price * 3n) / 10n) * 2n;
      const prize = (value * 188n) / 1000n;
      const stash = value - prize * 5n;
      await draw123456();
      expect(await lottery.getPrizes()).to.deep.equal([0n, prize, 0n, prize, stash]);
      expect(await lottery.getJackpot()).to.equal(stash);
      expect(await lottery.getStash()).to.equal(0);
      expect(await lottery.getOwnerRevenue()).to.equal(0);
      expect(await lottery.getPartnerRevenue(NULL_REFERRAL_CODE)).to.equal(0);
      expect(await lottery.getTotalRevenue()).to.equal(0);
    });
  });

  describe('getRoundData', () => {
    it('0 rounds', async () => {
      await expect(lottery.getRoundData(0)).to.be.reverted;
      await expect(lottery.getRoundData(1)).to.be.reverted;
    });

    it('1 round', async () => {
      await buyTicket([21, 22, 23, 24, 25, 26]);
      await buyTicket([1, 2, 3, 14, 15, 16]);
      await buyTicket([1, 2, 3, 4, 5, 16]);
      const price = await lottery.getBaseTicketPrice();
      const value = price * 3n - ((price * 3n) / 10n) * 2n;
      const prize = (value * 188n) / 1000n;
      const stash = value - prize * 5n;
      const block = await time.latestBlock();
      await draw123456();
      await expect(lottery.getRoundData(0)).to.be.reverted;
      const data = await lottery.getRoundData(1);
      expect(data.baseTicketPrice).to.equal(price);
      expect(data.prizes).to.deep.equal([prize, prize, prize, prize, prize]);
      expect(data.stash).to.equal(stash);
      expect(data.totalCombinations).to.equal(3);
      expect(data.drawBlockNumber).to.equal(block + 1);
      expect(data.vrfRequestId).to.equal(1);
      expect(data.numbers).to.deep.equal([1, 2, 3, 4, 5, 6]);
      expect(data.closureBlockNumber).to.equal(block + 2);
      expect(data.winners).to.deep.equal([0, 1, 0, 1, 0]);
      await expect(lottery.getRoundData(2)).to.be.reverted;
    });

    it('2 rounds', async () => {
      await buyTicket([1, 2, 13, 14, 15, 16]);
      await buyTicket([1, 2, 3, 4, 5, 6]);
      await buyTicket([1, 2, 3, 4, 25, 26]);
      const price1 = await lottery.getBaseTicketPrice();
      const value1 = price1 * 3n - ((price1 * 3n) / 10n) * 2n;
      const prize1 = (value1 * 188n) / 1000n;
      const stash1 = value1 - prize1 * 5n;
      const block1 = await time.latestBlock();
      await draw123456();
      await advanceTimeToNextDrawing();
      await buyTicket([21, 22, 23, 24, 25, 26]);
      await buyTicket([1, 2, 3, 14, 15, 16]);
      await buyTicket([1, 2, 3, 4, 5, 16]);
      const price2 = await lottery.getBaseTicketPrice();
      const value2 = price2 * 3n - ((price2 * 3n) / 10n) * 2n;
      const prize2 = (value2 * 188n) / 1000n;
      const stash2 = value2 - prize2 * 5n;
      const block2 = await time.latestBlock();
      await draw123456();
      const data1 = await lottery.getRoundData(1);
      expect(data1.baseTicketPrice).to.equal(price1);
      expect(data1.prizes).to.deep.equal([prize1, prize1, prize1, prize1, prize1]);
      expect(data1.stash).to.equal(stash1);
      expect(data1.totalCombinations).to.equal(3);
      expect(data1.drawBlockNumber).to.equal(block1 + 1);
      expect(data1.vrfRequestId).to.equal(1);
      expect(data1.numbers).to.deep.equal([1, 2, 3, 4, 5, 6]);
      expect(data1.closureBlockNumber).to.equal(block1 + 2);
      expect(data1.winners).to.deep.equal([1, 0, 1, 0, 1]);
      const data2 = await lottery.getRoundData(2);
      expect(data2.baseTicketPrice).to.equal(price2);
      expect(data2.prizes).to.deep.equal([
        prize2,
        prize1 + prize2,
        prize2,
        prize1 + prize2,
        stash1 + prize2,
      ]);
      expect(data2.stash).to.equal(stash2);
      expect(data2.totalCombinations).to.equal(3);
      expect(data2.drawBlockNumber).to.equal(block2 + 1);
      expect(data2.vrfRequestId).to.equal(2);
      expect(data2.numbers).to.deep.equal([1, 2, 3, 4, 5, 6]);
      expect(data2.closureBlockNumber).to.equal(block2 + 2);
      expect(data2.winners).to.deep.equal([0, 1, 0, 1, 0]);
      await expect(lottery.getRoundData(3)).to.be.reverted;
    });
  });

  describe('draw', () => {
    it('next draw time', async () => {
      const nextDrawTime = new Date(Number(1000n * (await lottery.getNextDrawTime())));
      expect(nextDrawTime.getUTCDay()).to.equal(6);
      expect(nextDrawTime.getUTCHours()).to.equal(20);
      expect(nextDrawTime.getUTCMinutes()).to.equal(0);
      expect(nextDrawTime.getUTCSeconds()).to.equal(0);
    });

    it('can draw', async () => {
      // must always succeed thanks to the advanceTimeToNextDrawing() call in the fixture
      expect(await lottery.canDraw()).to.equal(true);
    });

    it('cannot draw', async () => {
      await advanceTime(60 * 60 * 24);
      expect(await lottery.canDraw()).to.equal(false);
      await expect(lottery.draw(subscriptionId, process.env.CHAINLINK_VRF_KEY_HASH!)).to.be
        .reverted;
    });

    it('drawing window width', async () => {
      await advanceTime(ONE_HOUR);
      expect(await lottery.canDraw()).to.equal(true);
      await advanceTime(ONE_HOUR);
      expect(await lottery.canDraw()).to.equal(true);
      await advanceTime(ONE_HOUR);
      expect(await lottery.canDraw()).to.equal(true);
      await advanceTime(ONE_HOUR - 1);
      expect(await lottery.canDraw()).to.equal(true);
      await advanceTime(1);
      expect(await lottery.canDraw()).to.equal(false);
      await expect(lottery.draw(subscriptionId, process.env.CHAINLINK_VRF_KEY_HASH!)).to.be
        .reverted;
    });

    it('next drawing window', async () => {
      await advanceTime(ONE_WEEK - ONE_HOUR);
      expect(await lottery.canDraw()).to.equal(false);
      await expect(lottery.draw(subscriptionId, process.env.CHAINLINK_VRF_KEY_HASH!)).to.be
        .reverted;
      await advanceTimeToNextDrawing();
      expect(await lottery.canDraw()).to.equal(true);
      await advanceTime(THREE_HOURS);
      expect(await lottery.canDraw()).to.equal(true);
      await advanceTime(THREE_HOURS);
      expect(await lottery.canDraw()).to.equal(false);
      await expect(lottery.draw(subscriptionId, process.env.CHAINLINK_VRF_KEY_HASH!)).to.be
        .reverted;
    });

    it('only one draw per window', async () => {
      await draw123456();
      await advanceTime(ONE_HOUR);
      await expect(lottery.draw(subscriptionId, process.env.CHAINLINK_VRF_KEY_HASH!)).to.be
        .reverted;
    });

    it('skip a draw', async () => {
      await draw123456();
      await advanceTime(ONE_HOUR);
      await advanceTimeToNextDrawing();
      await advanceTime(THREE_DAYS);
      expect(await lottery.canDraw()).to.equal(false);
      const nextDrawTime = await lottery.getNextDrawTime();
      expect(nextDrawTime).to.be.above(await time.latest());
      const nextDrawDate = new Date(Number(nextDrawTime * 1000n));
      expect(nextDrawDate.getUTCDay()).to.equal(6);
      expect(nextDrawDate.getUTCHours()).to.equal(20);
      expect(nextDrawDate.getUTCMinutes()).to.equal(0);
      expect(nextDrawDate.getUTCSeconds()).to.equal(0);
      await advanceTimeToNextDrawing();
      expect(await lottery.canDraw()).to.equal(true);
    });
  });

  describe('tickets', () => {
    it('no tickets', async () => {
      await expect(lottery.playersByTicket(1)).to.be.reverted;
      expect(await lottery.getTicketIds(player)).to.deep.equal([]);
      await expect(lottery.getTicketIdsForRound(player, 0)).to.be.reverted;
      expect(await lottery.getTicketIdsForRound(player, 1)).to.deep.equal([]);
      await expect(lottery.getTicketIdsForRound(player, 2)).to.be.reverted;
      await expect(lottery.getTicket(0)).to.be.reverted;
      await expect(lottery.getTicket(1)).to.be.reverted;
      await expect(lottery.getTicketPrize(0)).to.be.reverted;
      await expect(lottery.getTicketPrize(1)).to.be.reverted;
    });

    it('one ticket', async () => {
      await buyTicket([1, 2, 3, 4, 5, 6]);
      expect(await lottery.playersByTicket(1)).to.equal(player);
      await expect(lottery.playersByTicket(2)).to.be.reverted;
      expect(await lottery.getTicketIds(player)).to.deep.equal([1]);
      await expect(lottery.getTicketIdsForRound(player, 0)).to.be.reverted;
      expect(await lottery.getTicketIdsForRound(player, 1)).to.deep.equal([1]);
      await expect(lottery.getTicketIdsForRound(player, 2)).to.be.reverted;
      await expect(lottery.getTicket(0)).to.be.reverted;
      const [account, round, , numbers] = await lottery.getTicket(1);
      expect(account).to.equal(player);
      expect(round).to.equal(1);
      expect(numbers).to.deep.equal([1, 2, 3, 4, 5, 6]);
      await expect(lottery.getTicket(2)).to.be.reverted;
      await expect(lottery.getTicketPrize(0)).to.be.reverted;
      await expect(lottery.getTicketPrize(1)).to.be.reverted;
      await expect(lottery.getTicketPrize(2)).to.be.reverted;
    });

    it('two tickets', async () => {
      await buyTicket([1, 3, 5, 7, 9, 11]);
      await buyTicket([2, 4, 6, 8, 10, 12]);
      expect(await lottery.playersByTicket(1)).to.equal(player);
      expect(await lottery.playersByTicket(2)).to.equal(player);
      await expect(lottery.playersByTicket(3)).to.be.reverted;
      expect(await lottery.getTicketIds(player)).to.deep.equal([1, 2]);
      await expect(lottery.getTicketIdsForRound(player, 0)).to.be.reverted;
      expect(await lottery.getTicketIdsForRound(player, 1)).to.deep.equal([1, 2]);
      await expect(lottery.getTicketIdsForRound(player, 2)).to.be.reverted;
      await expect(lottery.getTicket(0)).to.be.reverted;
      let [account, round, , numbers] = await lottery.getTicket(1);
      expect(account).to.equal(player);
      expect(round).to.equal(1);
      expect(numbers).to.deep.equal([1, 3, 5, 7, 9, 11]);
      [account, round, , numbers] = await lottery.getTicket(2);
      expect(account).to.equal(player);
      expect(round).to.equal(1);
      expect(numbers).to.deep.equal([2, 4, 6, 8, 10, 12]);
      await expect(lottery.getTicket(3)).to.be.reverted;
      await expect(lottery.getTicketPrize(0)).to.be.reverted;
      await expect(lottery.getTicketPrize(1)).to.be.reverted;
      await expect(lottery.getTicketPrize(2)).to.be.reverted;
      await expect(lottery.getTicketPrize(3)).to.be.reverted;
    });
  });

  describe('matches', () => {
    it('1 ticket, 0 matches', async () => {
      await buyTicket([10, 11, 12, 13, 14, 15]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([0, 0, 0, 0, 0]);
      const [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(0);
    });

    it('1 ticket, 1 match', async () => {
      await buyTicket([1, 12, 13, 14, 15, 16]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([0, 0, 0, 0, 0]);
      const [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(0);
    });

    it('1 ticket, 2 matches', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = price - (price / 10n) * 2n;
      const prize = (value * 188n) / 1000n;
      await buyTicket([1, 2, 13, 14, 15, 16]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([1, 0, 0, 0, 0]);
      const [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(prize);
    });

    it('1 ticket, 3 matches', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = price - (price / 10n) * 2n;
      const prize = (value * 188n) / 1000n;
      await buyTicket([1, 2, 3, 14, 15, 16]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([0, 1, 0, 0, 0]);
      const [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(prize);
    });

    it('1 ticket, 4 matches', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = price - (price / 10n) * 2n;
      const prize = (value * 188n) / 1000n;
      await buyTicket([1, 2, 3, 4, 15, 16]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([0, 0, 1, 0, 0]);
      const [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(prize);
    });

    it('1 ticket, 5 matches', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = price - (price / 10n) * 2n;
      const prize = (value * 188n) / 1000n;
      await buyTicket([1, 2, 3, 4, 5, 16]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([0, 0, 0, 1, 0]);
      const [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(prize);
    });

    it('1 ticket, 6 matches', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = price - (price / 10n) * 2n;
      const prize = (value * 188n) / 1000n;
      await buyTicket([1, 2, 3, 4, 5, 6]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([0, 0, 0, 0, 1]);
      const [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(prize);
    });

    it('2 tickets, 0 and 0 matches', async () => {
      await buyTicket([11, 12, 13, 14, 15, 16]);
      await buyTicket([21, 22, 23, 24, 25, 26]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([0, 0, 0, 0, 0]);
      let ticketPrize;
      [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(0);
      [, ticketPrize] = await lottery.getTicketPrize(2);
      expect(ticketPrize).to.equal(0);
    });

    it('2 tickets, 0 and 1 matches', async () => {
      await buyTicket([11, 12, 13, 14, 15, 16]);
      await buyTicket([1, 22, 23, 24, 25, 26]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([0, 0, 0, 0, 0]);
      let ticketPrize;
      [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(0);
      [, ticketPrize] = await lottery.getTicketPrize(2);
      expect(ticketPrize).to.equal(0);
    });

    it('2 tickets, 0 and 2 matches', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = (price - (price / 10n) * 2n) * 2n;
      const prize = (value * 188n) / 1000n;
      await buyTicket([11, 12, 13, 14, 15, 16]);
      await buyTicket([1, 2, 23, 24, 25, 26]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([1, 0, 0, 0, 0]);
      let ticketPrize;
      [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(0);
      [, ticketPrize] = await lottery.getTicketPrize(2);
      expect(ticketPrize).to.equal(prize);
    });

    it('2 tickets, 0 and 3 matches', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = (price - (price / 10n) * 2n) * 2n;
      const prize = (value * 188n) / 1000n;
      await buyTicket([11, 12, 13, 14, 15, 16]);
      await buyTicket([1, 2, 3, 24, 25, 26]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([0, 1, 0, 0, 0]);
      let ticketPrize;
      [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(0);
      [, ticketPrize] = await lottery.getTicketPrize(2);
      expect(ticketPrize).to.equal(prize);
    });

    it('2 tickets, 0 and 4 matches', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = (price - (price / 10n) * 2n) * 2n;
      const prize = (value * 188n) / 1000n;
      await buyTicket([11, 12, 13, 14, 15, 16]);
      await buyTicket([1, 2, 3, 4, 25, 26]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([0, 0, 1, 0, 0]);
      let ticketPrize;
      [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(0);
      [, ticketPrize] = await lottery.getTicketPrize(2);
      expect(ticketPrize).to.equal(prize);
    });

    it('2 tickets, 0 and 5 matches', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = (price - (price / 10n) * 2n) * 2n;
      const prize = (value * 188n) / 1000n;
      await buyTicket([11, 12, 13, 14, 15, 16]);
      await buyTicket([1, 2, 3, 4, 5, 26]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([0, 0, 0, 1, 0]);
      let ticketPrize;
      [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(0);
      [, ticketPrize] = await lottery.getTicketPrize(2);
      expect(ticketPrize).to.equal(prize);
    });

    it('2 tickets, 0 and 6 matches', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = (price - (price / 10n) * 2n) * 2n;
      const prize = (value * 188n) / 1000n;
      await buyTicket([11, 12, 13, 14, 15, 16]);
      await buyTicket([1, 2, 3, 4, 5, 6]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([0, 0, 0, 0, 1]);
      let ticketPrize;
      [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(0);
      [, ticketPrize] = await lottery.getTicketPrize(2);
      expect(ticketPrize).to.equal(prize);
    });

    it('2 tickets, 1 and 0 matches', async () => {
      await buyTicket([1, 12, 13, 14, 15, 16]);
      await buyTicket([21, 22, 23, 24, 25, 26]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([0, 0, 0, 0, 0]);
      let ticketPrize;
      [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(0);
      [, ticketPrize] = await lottery.getTicketPrize(2);
      expect(ticketPrize).to.equal(0);
    });

    it('2 tickets, 1 and 1 matches', async () => {
      await buyTicket([1, 12, 13, 14, 15, 16]);
      await buyTicket([1, 22, 23, 24, 25, 26]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([0, 0, 0, 0, 0]);
      let ticketPrize;
      [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(0);
      [, ticketPrize] = await lottery.getTicketPrize(2);
      expect(ticketPrize).to.equal(0);
    });

    it('2 tickets, 1 and 2 matches', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = (price - (price / 10n) * 2n) * 2n;
      const prize = (value * 188n) / 1000n;
      await buyTicket([1, 12, 13, 14, 15, 16]);
      await buyTicket([1, 2, 23, 24, 25, 26]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([1, 0, 0, 0, 0]);
      let ticketPrize;
      [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(0);
      [, ticketPrize] = await lottery.getTicketPrize(2);
      expect(ticketPrize).to.equal(prize);
    });

    it('2 tickets, 1 and 3 matches', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = (price - (price / 10n) * 2n) * 2n;
      const prize = (value * 188n) / 1000n;
      await buyTicket([1, 12, 13, 14, 15, 16]);
      await buyTicket([1, 2, 3, 24, 25, 26]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([0, 1, 0, 0, 0]);
      let ticketPrize;
      [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(0);
      [, ticketPrize] = await lottery.getTicketPrize(2);
      expect(ticketPrize).to.equal(prize);
    });

    it('2 tickets, 1 and 4 matches', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = (price - (price / 10n) * 2n) * 2n;
      const prize = (value * 188n) / 1000n;
      await buyTicket([1, 12, 13, 14, 15, 16]);
      await buyTicket([1, 2, 3, 4, 25, 26]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([0, 0, 1, 0, 0]);
      let ticketPrize;
      [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(0);
      [, ticketPrize] = await lottery.getTicketPrize(2);
      expect(ticketPrize).to.equal(prize);
    });

    it('2 tickets, 1 and 5 matches', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = (price - (price / 10n) * 2n) * 2n;
      const prize = (value * 188n) / 1000n;
      await buyTicket([1, 12, 13, 14, 15, 16]);
      await buyTicket([1, 2, 3, 4, 5, 26]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([0, 0, 0, 1, 0]);
      let ticketPrize;
      [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(0);
      [, ticketPrize] = await lottery.getTicketPrize(2);
      expect(ticketPrize).to.equal(prize);
    });

    it('2 tickets, 1 and 6 matches', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = (price - (price / 10n) * 2n) * 2n;
      const prize = (value * 188n) / 1000n;
      await buyTicket([1, 12, 13, 14, 15, 16]);
      await buyTicket([1, 2, 3, 4, 5, 6]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([0, 0, 0, 0, 1]);
      let ticketPrize;
      [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(0);
      [, ticketPrize] = await lottery.getTicketPrize(2);
      expect(ticketPrize).to.equal(prize);
    });

    it('2 tickets, 2 and 0 matches', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = (price - (price / 10n) * 2n) * 2n;
      const prize = (value * 188n) / 1000n;
      await buyTicket([1, 2, 13, 14, 15, 16]);
      await buyTicket([21, 22, 23, 24, 25, 26]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([1, 0, 0, 0, 0]);
      let ticketPrize;
      [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(prize);
      [, ticketPrize] = await lottery.getTicketPrize(2);
      expect(ticketPrize).to.equal(0);
    });

    it('2 tickets, 2 and 1 matches', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = (price - (price / 10n) * 2n) * 2n;
      const prize = (value * 188n) / 1000n;
      await buyTicket([1, 2, 13, 14, 15, 16]);
      await buyTicket([1, 22, 23, 24, 25, 26]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([1, 0, 0, 0, 0]);
      let ticketPrize;
      [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(prize);
      [, ticketPrize] = await lottery.getTicketPrize(2);
      expect(ticketPrize).to.equal(0);
    });

    it('2 tickets, 2 and 2 matches', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = (price - (price / 10n) * 2n) * 2n;
      const prize = (value * 188n) / 1000n / 2n;
      await buyTicket([1, 2, 13, 14, 15, 16]);
      await buyTicket([1, 2, 23, 24, 25, 26]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([2, 0, 0, 0, 0]);
      let ticketPrize;
      [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(prize);
      [, ticketPrize] = await lottery.getTicketPrize(2);
      expect(ticketPrize).to.equal(prize);
    });

    it('2 tickets, 2 and 3 matches', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = (price - (price / 10n) * 2n) * 2n;
      const prize = (value * 188n) / 1000n;
      await buyTicket([1, 2, 13, 14, 15, 16]);
      await buyTicket([1, 2, 3, 24, 25, 26]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([1, 1, 0, 0, 0]);
      let ticketPrize;
      [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(prize);
      [, ticketPrize] = await lottery.getTicketPrize(2);
      expect(ticketPrize).to.equal(prize);
    });

    it('2 tickets, 2 and 4 matches', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = (price - (price / 10n) * 2n) * 2n;
      const prize = (value * 188n) / 1000n;
      await buyTicket([1, 2, 13, 14, 15, 16]);
      await buyTicket([1, 2, 3, 4, 25, 26]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([1, 0, 1, 0, 0]);
      let ticketPrize;
      [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(prize);
      [, ticketPrize] = await lottery.getTicketPrize(2);
      expect(ticketPrize).to.equal(prize);
    });

    it('2 tickets, 2 and 5 matches', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = (price - (price / 10n) * 2n) * 2n;
      const prize = (value * 188n) / 1000n;
      await buyTicket([1, 2, 13, 14, 15, 16]);
      await buyTicket([1, 2, 3, 4, 5, 26]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([1, 0, 0, 1, 0]);
      let ticketPrize;
      [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(prize);
      [, ticketPrize] = await lottery.getTicketPrize(2);
      expect(ticketPrize).to.equal(prize);
    });

    it('2 tickets, 2 and 6 matches', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = (price - (price / 10n) * 2n) * 2n;
      const prize = (value * 188n) / 1000n;
      await buyTicket([1, 2, 13, 14, 15, 16]);
      await buyTicket([1, 2, 3, 4, 5, 6]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([1, 0, 0, 0, 1]);
      let ticketPrize;
      [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(prize);
      [, ticketPrize] = await lottery.getTicketPrize(2);
      expect(ticketPrize).to.equal(prize);
    });

    it('2 tickets, 3 and 0 matches', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = (price - (price / 10n) * 2n) * 2n;
      const prize = (value * 188n) / 1000n;
      await buyTicket([1, 2, 3, 14, 15, 16]);
      await buyTicket([21, 22, 23, 24, 25, 26]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([0, 1, 0, 0, 0]);
      let ticketPrize;
      [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(prize);
      [, ticketPrize] = await lottery.getTicketPrize(2);
      expect(ticketPrize).to.equal(0);
    });

    it('2 tickets, 3 and 1 matches', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = (price - (price / 10n) * 2n) * 2n;
      const prize = (value * 188n) / 1000n;
      await buyTicket([1, 2, 3, 14, 15, 16]);
      await buyTicket([1, 22, 23, 24, 25, 26]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([0, 1, 0, 0, 0]);
      let ticketPrize;
      [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(prize);
      [, ticketPrize] = await lottery.getTicketPrize(2);
      expect(ticketPrize).to.equal(0);
    });

    it('2 tickets, 3 and 2 matches', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = (price - (price / 10n) * 2n) * 2n;
      const prize = (value * 188n) / 1000n;
      await buyTicket([1, 2, 3, 14, 15, 16]);
      await buyTicket([1, 2, 23, 24, 25, 26]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([1, 1, 0, 0, 0]);
      let ticketPrize;
      [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(prize);
      [, ticketPrize] = await lottery.getTicketPrize(2);
      expect(ticketPrize).to.equal(prize);
    });

    it('2 tickets, 3 and 3 matches', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = (price - (price / 10n) * 2n) * 2n;
      const prize = (value * 188n) / 1000n / 2n;
      await buyTicket([1, 2, 3, 14, 15, 16]);
      await buyTicket([1, 2, 3, 24, 25, 26]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([0, 2, 0, 0, 0]);
      let ticketPrize;
      [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(prize);
      [, ticketPrize] = await lottery.getTicketPrize(2);
      expect(ticketPrize).to.equal(prize);
    });

    it('2 tickets, 3 and 4 matches', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = (price - (price / 10n) * 2n) * 2n;
      const prize = (value * 188n) / 1000n;
      await buyTicket([1, 2, 3, 14, 15, 16]);
      await buyTicket([1, 2, 3, 4, 25, 26]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([0, 1, 1, 0, 0]);
      let ticketPrize;
      [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(prize);
      [, ticketPrize] = await lottery.getTicketPrize(2);
      expect(ticketPrize).to.equal(prize);
    });

    it('2 tickets, 3 and 5 matches', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = (price - (price / 10n) * 2n) * 2n;
      const prize = (value * 188n) / 1000n;
      await buyTicket([1, 2, 3, 14, 15, 16]);
      await buyTicket([1, 2, 3, 4, 5, 26]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([0, 1, 0, 1, 0]);
      let ticketPrize;
      [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(prize);
      [, ticketPrize] = await lottery.getTicketPrize(2);
      expect(ticketPrize).to.equal(prize);
    });

    it('2 tickets, 3 and 6 matches', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = (price - (price / 10n) * 2n) * 2n;
      const prize = (value * 188n) / 1000n;
      await buyTicket([1, 2, 3, 14, 15, 16]);
      await buyTicket([1, 2, 3, 4, 5, 6]);
      await draw123456();
      const [, , , , , , , , winners] = await lottery.getRoundData(1);
      expect(winners).to.deep.equal([0, 1, 0, 0, 1]);
      let ticketPrize;
      [, ticketPrize] = await lottery.getTicketPrize(1);
      expect(ticketPrize).to.equal(prize);
      [, ticketPrize] = await lottery.getTicketPrize(2);
      expect(ticketPrize).to.equal(prize);
    });
  });

  describe('prizes', () => {
    it('withdraw', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = price - (price / 10n) * 2n;
      const prize = (value * 188n) / 1000n;
      await buyTicket([1, 2, 3, 14, 15, 16]);
      await draw123456();
      let ticket = await lottery.getTicketPrize(1);
      expect(ticket.player).to.equal(await player.getAddress());
      expect(ticket.prize).to.equal(prize);
      expect(ticket.withdrawBlockNumber).to.equal(0);
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(value);
      await lottery.withdrawPrize(1);
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(value - prize);
      ticket = await lottery.getTicketPrize(1);
      expect(ticket.player).to.equal(await player.getAddress());
      expect(ticket.prize).to.equal(prize);
      expect(ticket.withdrawBlockNumber).to.equal(await time.latestBlock());
    });

    it('double withdrawal', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = price - (price / 10n) * 2n;
      const prize = (value * 188n) / 1000n;
      await buyTicket([1, 2, 3, 14, 15, 16]);
      await draw123456();
      const block = await time.latestBlock();
      await lottery.withdrawPrize(1);
      await expect(lottery.withdrawPrize(1)).to.be.reverted;
      const ticket = await lottery.getTicketPrize(1);
      expect(ticket.player).to.equal(await player.getAddress());
      expect(ticket.prize).to.equal(prize);
      expect(ticket.withdrawBlockNumber).to.equal(block + 1);
    });

    it('two withdrawals', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = price * 2n - ((price * 2n) / 10n) * 2n;
      const prize = (value * 188n) / 1000n;
      await buyTicket([1, 2, 13, 14, 15, 16]);
      await buyTicket([1, 2, 3, 14, 15, 16]);
      await draw123456();
      await lottery.withdrawPrize(1);
      let ticket2 = await lottery.getTicketPrize(2);
      expect(ticket2.player).to.equal(await player.getAddress());
      expect(ticket2.prize).to.equal(prize);
      expect(ticket2.withdrawBlockNumber).to.equal(0);
      await lottery.withdrawPrize(2);
      ticket2 = await lottery.getTicketPrize(2);
      expect(ticket2.player).to.equal(await player.getAddress());
      expect(ticket2.prize).to.equal(prize);
      expect(ticket2.withdrawBlockNumber).to.equal(await time.latestBlock());
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(value - prize * 2n);
      await expect(lottery.withdrawPrize(1)).to.be.reverted;
      await expect(lottery.withdrawPrize(2)).to.be.reverted;
    });
  });

  describe('higher order tickets', () => {
    it('7 numbers', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = price * 9n - ((price * 9n) / 10n) * 2n;
      const prize = (value * 188n) / 1000n;
      const stash = value - prize * 5n;
      await buyTicket([1, 2, 13, 14, 15, 16]);
      await buyTicket([1, 2, 3, 4, 15, 16, 17]);
      await buyTicket([1, 2, 3, 14, 15, 16]);
      const block = await time.latestBlock();
      await draw123456();
      const data = await lottery.getRoundData(1);
      expect(data.baseTicketPrice).to.equal(price);
      expect(data.prizes).to.deep.equal([prize, prize, prize, prize, prize]);
      expect(data.stash).to.equal(stash);
      expect(data.totalCombinations).to.equal(9);
      expect(data.drawBlockNumber).to.equal(block + 1);
      expect(data.vrfRequestId).to.equal(1);
      expect(data.numbers).to.deep.equal([1, 2, 3, 4, 5, 6]);
      expect(data.closureBlockNumber).to.equal(block + 2);
      expect(data.winners).to.deep.equal([1, 5, 3, 0, 0]);
      let ticket = await lottery.getTicketPrize(2);
      expect(ticket.player).to.equal(await player.getAddress());
      expect(ticket.prize).to.equal((prize * 4n) / 5n + prize);
      expect(ticket.withdrawBlockNumber).to.equal(0);
      await lottery.withdrawPrize(2);
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(value - ticket.prize);
      ticket = await lottery.getTicketPrize(2);
      expect(ticket.player).to.equal(await player.getAddress());
      expect(ticket.prize).to.equal((prize * 4n) / 5n + prize);
      expect(ticket.withdrawBlockNumber).to.equal(block + 3);
      await expect(lottery.withdrawPrize(2)).to.be.reverted;
    });

    it('8 numbers', async () => {
      const price = await lottery.getBaseTicketPrice();
      const value = price * 30n - ((price * 30n) / 10n) * 2n;
      const prize = (value * 188n) / 1000n;
      const stash = value - prize * 5n;
      await buyTicket([1, 2, 13, 14, 15, 16]);
      await buyTicket([1, 2, 3, 4, 15, 16, 17, 18]);
      await buyTicket([1, 2, 3, 14, 15, 16]);
      const block = await time.latestBlock();
      await draw123456();
      const data = await lottery.getRoundData(1);
      expect(data.baseTicketPrice).to.equal(price);
      expect(data.prizes).to.deep.equal([prize, prize, prize, prize, prize]);
      expect(data.stash).to.equal(stash);
      expect(data.totalCombinations).to.equal(30);
      expect(data.drawBlockNumber).to.equal(block + 1);
      expect(data.vrfRequestId).to.equal(1);
      expect(data.numbers).to.deep.equal([1, 2, 3, 4, 5, 6]);
      expect(data.closureBlockNumber).to.equal(block + 2);
      expect(data.winners).to.deep.equal([7, 17, 6, 0, 0]);
      let ticket = await lottery.getTicketPrize(2);
      expect(ticket.player).to.equal(await player.getAddress());
      expect(ticket.prize).to.equal((prize * 6n) / 7n + (prize * 16n) / 17n + prize);
      expect(ticket.withdrawBlockNumber).to.equal(0);
      await lottery.withdrawPrize(2);
      expect(await currencyToken.balanceOf(lotteryAddress)).to.equal(value - ticket.prize);
      ticket = await lottery.getTicketPrize(2);
      expect(ticket.player).to.equal(await player.getAddress());
      expect(ticket.prize).to.equal((prize * 6n) / 7n + (prize * 16n) / 17n + prize);
      expect(ticket.withdrawBlockNumber).to.equal(block + 3);
      await expect(lottery.withdrawPrize(2)).to.be.reverted;
    });
  });
});
