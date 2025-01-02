import { expect } from 'chai';

import { ethers } from 'hardhat';
import type { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers';
import { takeSnapshot, time } from '@nomicfoundation/hardhat-network-helpers';

import type { Signer } from 'ethers';
import { LotteryToken } from '../typechain-types';

import { Deployer } from '../scripts/deployer';

describe('Token', () => {
  const deployer = new Deployer();

  let account1: Signer;
  let account2: Signer;
  let token: LotteryToken;

  let snapshot: SnapshotRestorer;

  before(async () => {
    await deployer.init();
    [account1, account2] = await ethers.getSigners();
    token = await deployer.deployToken();
  });

  beforeEach(async () => {
    snapshot = await takeSnapshot();
  });

  afterEach(async () => {
    await snapshot.restore();
  });

  it('initial state', async () => {
    const t = await time.latestBlock();
    expect(await token.getTotalVotes()).to.equal(0);
    expect(await token.getPastTotalVotes(t - 1)).to.equal(0);
    expect(await token.getPastTotalVotes(t)).to.equal(0);
    expect(await token.getPastTotalVotes(t + 1)).to.equal(0);
  });

  it('transfer', async () => {
    await token.transfer(account2, 1000);
    const t = await time.latestBlock();
    expect(await token.getTotalVotes()).to.equal(0);
    expect(await token.getPastTotalVotes(t - 1)).to.equal(0);
    expect(await token.getPastTotalVotes(t)).to.equal(0);
    expect(await token.getPastTotalVotes(t + 1)).to.equal(0);
  });

  it('burn', async () => {
    await token.burn(1000);
    const t = await time.latestBlock();
    expect(await token.getTotalVotes()).to.equal(0);
    expect(await token.getPastTotalVotes(t - 1)).to.equal(0);
    expect(await token.getPastTotalVotes(t)).to.equal(0);
    expect(await token.getPastTotalVotes(t + 1)).to.equal(0);
  });

  it('delegated', async () => {
    const totalSupply = await token.totalSupply();
    const t0 = await time.latestBlock();
    await token.delegate(account2);
    const t1 = await time.latestBlock();
    expect(await token.getTotalVotes()).to.equal(totalSupply);
    expect(await token.getPastTotalVotes(t0)).to.equal(0);
    expect(await token.getPastTotalVotes(t1)).to.equal(totalSupply);
    expect(await token.getPastTotalVotes(t1 + 1)).to.equal(totalSupply);
  });

  it('transfer and delegate', async () => {
    const totalSupply = await token.totalSupply();
    const t0 = await time.latestBlock();
    await token.transfer(account2, 1000);
    const t1 = await time.latestBlock();
    await token.delegate(account2);
    const t2 = await time.latestBlock();
    expect(await token.getTotalVotes()).to.equal(totalSupply - 1000n);
    expect(await token.getPastTotalVotes(t0)).to.equal(0);
    expect(await token.getPastTotalVotes(t1)).to.equal(0);
    expect(await token.getPastTotalVotes(t2)).to.equal(totalSupply - 1000n);
    expect(await token.getPastTotalVotes(t2 + 1)).to.equal(totalSupply - 1000n);
  });

  it('delegate and transfer', async () => {
    const totalSupply = await token.totalSupply();
    const t0 = await time.latestBlock();
    await token.delegate(account2);
    const t1 = await time.latestBlock();
    await token.transfer(account2, 1000);
    const t2 = await time.latestBlock();
    expect(await token.getTotalVotes()).to.equal(totalSupply - 1000n);
    expect(await token.getPastTotalVotes(t0)).to.equal(0);
    expect(await token.getPastTotalVotes(t1)).to.equal(totalSupply);
    expect(await token.getPastTotalVotes(t2)).to.equal(totalSupply - 1000n);
    expect(await token.getPastTotalVotes(t2 + 1)).to.equal(totalSupply - 1000n);
  });

  it('delegate and burn', async () => {
    const totalSupply = await token.totalSupply();
    const t0 = await time.latestBlock();
    await token.delegate(account2);
    const t1 = await time.latestBlock();
    await token.burn(1234);
    const t2 = await time.latestBlock();
    expect(await token.getTotalVotes()).to.equal(totalSupply - 1234n);
    expect(await token.getPastTotalVotes(t0)).to.equal(0);
    expect(await token.getPastTotalVotes(t1)).to.equal(totalSupply);
    expect(await token.getPastTotalVotes(t2)).to.equal(totalSupply - 1234n);
    expect(await token.getPastTotalVotes(t2 + 1)).to.equal(totalSupply - 1234n);
  });
});
