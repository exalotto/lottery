import { ethers } from 'hardhat';

import type {
  Drawing,
  FakeToken,
  Lottery,
  LotteryController,
  LotteryGovernor,
  LotteryICO,
  LotteryToken,
  MockVRFCoordinator,
  TicketIndex,
  UserTickets,
} from '../typechain-types';

import { deploy, deployWithProxy, getDefaultSigner, send } from './utils';

// We use Dai and this is in wei, so it's $1.50.
const INITIAL_TICKET_PRICE = 1500000000000000000n;

export class Deployer {
  private _signers: string[] = [];
  private _deployer: string | null = null;
  private _owner: string | null = null;

  public async getDefaultSigner(): Promise<string> {
    const signer = await getDefaultSigner();
    return await signer.getAddress();
  }

  public async init(owner?: string): Promise<void> {
    this._signers = (await ethers.getSigners()).map(signer => signer.address);
    this._owner = owner || (await this.getDefaultSigner());
    this._deployer = this._signers[0];
    console.log('Deployer initialized, the signer is', this._deployer);
  }

  public deployFakeTokenForTesting(): Promise<FakeToken> {
    return deploy('FakeToken');
  }

  public deployMockVRFCoordinator(): Promise<MockVRFCoordinator> {
    return deploy('MockVRFCoordinator');
  }

  public _deployToken(): Promise<LotteryToken> {
    return deploy('LotteryToken');
  }

  public async deployToken(): Promise<LotteryToken> {
    const token = await this._deployToken();
    if (this._deployer !== this._owner) {
      const totalSupply = await token.totalSupply();
      const tx = await send(token, 'transfer', this._owner, totalSupply);
      console.log(`Total EXL supply transferred to ${this._owner} -- txid ${tx.hash}`);
    }
    return token;
  }

  public async deployLibraries(): Promise<{
    drawingLibrary: Drawing;
    indexLibrary: TicketIndex;
    ticketLibrary: UserTickets;
  }> {
    const drawingLibrary = await deploy<Drawing>('Drawing');
    const indexLibrary = await deploy<TicketIndex>('TicketIndex');
    const ticketLibrary = await deploy<UserTickets>('UserTickets');
    return { drawingLibrary, indexLibrary, ticketLibrary };
  }

  public async deployLotteryImpl({
    drawingLibrary,
    indexLibrary,
    ticketLibrary,
  }: {
    drawingLibrary: Drawing;
    indexLibrary: TicketIndex;
    ticketLibrary: UserTickets;
  }): Promise<Lottery> {
    const [drawingLibraryAddress, indexLibraryAddress, ticketLibraryAddress] = await Promise.all([
      drawingLibrary.getAddress(),
      indexLibrary.getAddress(),
      ticketLibrary.getAddress(),
    ]);
    return await deploy<Lottery>('Lottery', [], {
      Drawing: drawingLibraryAddress,
      TicketIndex: indexLibraryAddress,
      UserTickets: ticketLibraryAddress,
    });
  }

  public async deployLottery(
    currencyToken: string = process.env.EXALOTTO_CURRENCY_TOKEN!,
    vrfCoordinatorAddress: string = process.env.CHAINLINK_VRF_COORDINATOR!,
  ): Promise<{
    drawingLibrary: Drawing;
    indexLibrary: TicketIndex;
    ticketLibrary: UserTickets;
    lottery: Lottery;
  }> {
    const { drawingLibrary, indexLibrary, ticketLibrary } = await this.deployLibraries();
    const [drawingLibraryAddress, indexLibraryAddress, ticketLibraryAddress] = await Promise.all([
      drawingLibrary.getAddress(),
      indexLibrary.getAddress(),
      ticketLibrary.getAddress(),
    ]);
    const lottery = await deployWithProxy<Lottery>(
      'Lottery',
      [currencyToken, vrfCoordinatorAddress, INITIAL_TICKET_PRICE],
      {
        Drawing: drawingLibraryAddress,
        TicketIndex: indexLibraryAddress,
        UserTickets: ticketLibraryAddress,
      },
    );
    return { drawingLibrary, indexLibrary, ticketLibrary, lottery };
  }

  public async deployController(token: LotteryToken, lottery: Lottery): Promise<LotteryController> {
    const owners = [this._owner];
    let tx;
    const controller = await deploy<LotteryController>(
      'LotteryController',
      await Promise.all([
        token.getAddress(),
        lottery.getAddress(),
        /*proposers=*/ Promise.resolve(owners),
        /*executors=*/ Promise.resolve(owners),
      ]),
    );
    const [controllerAddress, DEFAULT_ADMIN_ROLE, PROPOSER_ROLE, EXECUTOR_ROLE, CANCELLER_ROLE] =
      await Promise.all([
        controller.getAddress(),
        controller.DEFAULT_ADMIN_ROLE(),
        controller.PROPOSER_ROLE(),
        controller.EXECUTOR_ROLE(),
        controller.CANCELLER_ROLE(),
      ]);
    tx = await send(lottery, 'transferOwnership', controllerAddress);
    console.log(`Lottery ownership transferred to ${controllerAddress} -- txid ${tx.hash}`);
    tx = await send(controller, 'grantRole', DEFAULT_ADMIN_ROLE, this._owner);
    console.log(`DEFAULT_ADMIN_ROLE granted to ${this._owner} -- txid ${tx.hash}`);
    if (this._deployer !== this._owner) {
      tx = await send(controller, 'renounceRole', PROPOSER_ROLE, this._deployer);
      console.log(`PROPOSER_ROLE renounced by ${this._deployer} -- txid ${tx.hash}`);
      tx = await send(controller, 'renounceRole', EXECUTOR_ROLE, this._deployer);
      console.log(`EXECUTOR_ROLE renounced by ${this._deployer} -- txid ${tx.hash}`);
      tx = await send(controller, 'renounceRole', CANCELLER_ROLE, this._deployer);
      console.log(`CANCELLER_ROLE renounced by ${this._deployer} -- txid ${tx.hash}`);
    }
    return controller;
  }

  public async deployGovernor(
    token: LotteryToken,
    controller: LotteryController,
  ): Promise<LotteryGovernor> {
    const [DEFAULT_ADMIN_ROLE, PROPOSER_ROLE, EXECUTOR_ROLE, CANCELLER_ROLE] = await Promise.all([
      controller.DEFAULT_ADMIN_ROLE(),
      controller.PROPOSER_ROLE(),
      controller.EXECUTOR_ROLE(),
      controller.CANCELLER_ROLE(),
    ]);
    let tx;
    const governor = await deploy<LotteryGovernor>(
      'LotteryGovernor',
      await Promise.all([token.getAddress(), controller.getAddress()]),
    );
    const governorAddress = await governor.getAddress();
    tx = await send(controller, 'grantRole', DEFAULT_ADMIN_ROLE, governorAddress);
    console.log(`DEFAULT_ADMIN_ROLE granted to ${governorAddress} -- txid ${tx.hash}`);
    tx = await send(controller, 'grantRole', PROPOSER_ROLE, governorAddress);
    console.log(`PROPOSER_ROLE granted to ${governorAddress} -- txid ${tx.hash}`);
    tx = await send(controller, 'grantRole', EXECUTOR_ROLE, governorAddress);
    console.log(`EXECUTOR_ROLE granted to ${governorAddress} -- txid ${tx.hash}`);
    tx = await send(controller, 'grantRole', CANCELLER_ROLE, governorAddress);
    console.log(`CANCELLER_ROLE granted to ${governorAddress} -- txid ${tx.hash}`);
    if (this._deployer !== this._owner) {
      tx = await send(controller, 'renounceRole', DEFAULT_ADMIN_ROLE, this._deployer);
      console.log(`DEFAULT_ADMIN_ROLE renounced by ${this._deployer} -- txid ${tx.hash}`);
    }
    return governor;
  }

  public async deployGovernance(
    currencyTokenAddress: string = process.env.EXALOTTO_CURRENCY_TOKEN!,
    vrfCoordinatorAddress: string = process.env.CHAINLINK_VRF_COORDINATOR!,
  ): Promise<{
    token: LotteryToken;
    lottery: Lottery;
    controller: LotteryController;
    governor: LotteryGovernor;
  }> {
    const token = await this.deployToken();
    const { lottery } = await this.deployLottery(currencyTokenAddress, vrfCoordinatorAddress);
    const controller = await this.deployController(token, lottery);
    const governor = await this.deployGovernor(token, controller);
    return { token, lottery, controller, governor };
  }

  public async deployICO(
    currencyTokenAddress: string,
    token: LotteryToken,
    lottery: Lottery,
  ): Promise<LotteryICO> {
    const [tokenAddress, lotteryAddress] = await Promise.all([
      token.getAddress(),
      lottery.getAddress(),
    ]);
    const ico = await deploy<LotteryICO>('LotteryICO', [
      currencyTokenAddress,
      tokenAddress,
      lotteryAddress,
    ]);
    const icoAddress = await ico.getAddress();
    let tx = await send(token, 'transfer', icoAddress, await token.totalSupply());
    console.log(`Total EXL supply transferred to ${icoAddress} -- txid ${tx.hash}`);
    if (this._deployer !== this._owner) {
      tx = await send(ico, 'transferOwnership', this._owner);
      console.log(`ICO ownership transferred to ${this._owner} -- txid ${tx.hash}`);
    }
    return ico;
  }

  public async deployAll(
    currencyTokenAddress: string = process.env.EXALOTTO_CURRENCY_TOKEN!,
    vrfCoordinatorAddress: string = process.env.CHAINLINK_VRF_COORDINATOR!,
  ): Promise<{
    token: LotteryToken;
    lottery: Lottery;
    controller: LotteryController;
    governor: LotteryGovernor;
    ico: LotteryICO;
  }> {
    const token = await this._deployToken();
    const { lottery } = await this.deployLottery(currencyTokenAddress, vrfCoordinatorAddress);
    const controller = await this.deployController(token, lottery);
    const governor = await this.deployGovernor(token, controller);
    const ico = await this.deployICO(currencyTokenAddress, token, lottery);
    return { token, lottery, controller, governor, ico };
  }
}
