import { expect } from 'chai';

import { ethers } from 'hardhat';
import { takeSnapshot, SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers';

import { BaseContract } from 'ethers';
import type { IERC20, Lottery, MockVRFCoordinator } from '../typechain-types';
import { abi as erc20abi } from '../artifacts/@openzeppelin/contracts/token/ERC20/IERC20.sol/IERC20.json';

import { Deployer } from '../scripts/deployer';
import { advanceTime, advanceTimeToNextDrawing, range } from './utils';

const NULL_REFERRAL_CODE = '0x0000000000000000000000000000000000000000000000000000000000000000';
const REFERRAL_CODE1 = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const REFERRAL_CODE2 = '0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

describe('Lottery', () => {
  const deployer = new Deployer();

  let owner: string, partner: string, player: string;

  let vrfCoordinator: MockVRFCoordinator;
  const subscriptionId: number = 1;
  let requestId: number = 1;

  let snapshot: SnapshotRestorer;

  const currencyTokenAddress = '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063';
  let currencyToken: IERC20;

  let lotteryAddress: string;
  let lottery: Lottery, partnerLottery: Lottery, playerLottery: Lottery;

  before(async () => {
    await deployer.init();
    const signers = await ethers.getSigners();
    owner = signers[0].address;
    partner = signers[1].address;
    player = signers[2].address;
    vrfCoordinator = await deployer.deployMockVRFCoordinator();
    await vrfCoordinator.createSubscription();
    currencyToken = BaseContract.from<IERC20>(currencyTokenAddress, erc20abi);
    lottery = (await deployer.deployLottery(await vrfCoordinator.getAddress())).lottery;
    lotteryAddress = await lottery.getAddress();
    partnerLottery = lottery.connect(signers[1]);
    playerLottery = lottery.connect(signers[2]);
    await vrfCoordinator.addConsumer(subscriptionId, lotteryAddress);
    await partnerLottery.claimReferralCode(REFERRAL_CODE1, partner);
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
    const price = await playerLottery.getTicketPrice(numbers);
    currencyToken.approve(lotteryAddress, price);
    await playerLottery.createTicket(NULL_REFERRAL_CODE, numbers);
  };

  const draw = async () => {
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

  // TODO
});
