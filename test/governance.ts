import { expect } from 'chai';

import 'hardhat';
import type { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers';
import { mine, takeSnapshot } from '@nomicfoundation/hardhat-network-helpers';

import type {
  FakeToken,
  Lottery,
  LotteryController,
  LotteryToken,
  MockVRFCoordinator,
} from '../typechain-types';

import { Deployer } from '../scripts/deployer';
import { advanceTime, advanceTimeToNextDrawing } from './utils';

const NULL_REFERRAL_CODE = '0x0000000000000000000000000000000000000000000000000000000000000000';

const ONE_WEEK = 60 * 60 * 24 * 7;

describe('Governance', () => {
  const deployer = new Deployer();

  let signer: string;

  let currencyToken: FakeToken;
  let vrfCoordinator: MockVRFCoordinator;
  const subscriptionId = 1;
  let requestId = 1;

  let snapshot: SnapshotRestorer;
  let token: LotteryToken;
  let lottery: Lottery;
  let lotteryAddress: string;
  let controller: LotteryController;

  before(async () => {
    await deployer.init();
    signer = await deployer.getDefaultSigner();
    currencyToken = await deployer.deployFakeTokenForTesting();
    vrfCoordinator = await deployer.deployMockVRFCoordinator();
    await vrfCoordinator.createSubscription();
    const [currencyTokenAddress, vrfCoordinatorAddress] = await Promise.all([
      currencyToken.getAddress(),
      vrfCoordinator.getAddress(),
    ]);
    ({ token, lottery, controller } = await deployer.deployGovernance(
      currencyTokenAddress,
      vrfCoordinatorAddress,
    ));
    lotteryAddress = await lottery.getAddress();
    await vrfCoordinator.addConsumer(subscriptionId, lotteryAddress);
    await token.delegate(signer);
  });

  beforeEach(async () => {
    snapshot = await takeSnapshot();
    await advanceTimeToNextDrawing();
  });

  afterEach(async () => {
    await snapshot.restore();
    requestId = 1;
  });

  const buyTicket = async (numbers: number[]) => {
    const price = await lottery.getTicketPrice(numbers);
    await currencyToken.mint(price);
    await currencyToken.approve(lotteryAddress, price);
    await lottery.createTicket(NULL_REFERRAL_CODE, numbers);
  };

  const draw = async () => {
    await controller.draw(subscriptionId, process.env.CHAINLINK_VRF_KEY_HASH!);
    await vrfCoordinator.fulfillRandomWordsWithOverride(requestId++, lotteryAddress, [0], {
      gasLimit: process.env.EXALOTTO_CALLBACK_GAS_LIMIT,
    });
    await mine();
    await controller.closeRound();
    await mine();
  };

  it('pause', async () => {
    expect(await lottery.paused()).to.equal(false);
    expect(await controller.paused()).to.equal(false);
    await controller.pause();
    expect(await lottery.paused()).to.equal(true);
    expect(await controller.paused()).to.equal(true);
    await controller.unpause();
    expect(await lottery.paused()).to.equal(false);
    expect(await controller.paused()).to.equal(false);
  });

  it('initial revenue', async () => {
    expect(await controller.getUnclaimedRevenue(signer)).to.equal(0);
  });

  it('revenue', async () => {
    await buyTicket([4, 5, 6, 7, 8, 9]);
    await draw();
    const balance = await currencyToken.balanceOf(await controller.getAddress());
    expect(balance).to.not.equal(0);
    const unclaimed = await controller.getUnclaimedRevenue(signer);
    expect(balance).to.equal(unclaimed);
  });

  it('revenue growth', async () => {
    await buyTicket([1, 2, 3, 4, 5, 6]);
    await draw();
    await advanceTime(ONE_WEEK);
    const unclaimed1 = await controller.getUnclaimedRevenue(signer);
    await buyTicket([4, 5, 6, 7, 8, 9]);
    await draw();
    const unclaimed2 = await controller.getUnclaimedRevenue(signer);
    expect(unclaimed2).gt(unclaimed1);
    const balance = await currencyToken.balanceOf(await controller.getAddress());
    expect(balance).to.equal(unclaimed2);
  });

  it('withdrawal', async () => {
    await buyTicket([1, 2, 3, 4, 5, 6]);
    await buyTicket([4, 5, 6, 7, 8, 9]);
    await draw();
    await controller.withdraw(signer);
    const unclaimed2 = await controller.getUnclaimedRevenue(signer);
    expect(unclaimed2).to.equal(0);
  });
});
