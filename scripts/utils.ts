import { ethers, upgrades } from 'hardhat';

import type { Libraries } from 'hardhat/types';
import type { BaseContract, ContractMethod, Signer, Transaction } from 'ethers';
import type { DeployProxyOptions } from '@openzeppelin/hardhat-upgrades/dist/utils';

import { createInterface } from 'readline';

let nonce = process.env.EXALOTTO_NONCE_OVERRIDE
  ? parseInt(process.env.EXALOTTO_NONCE_OVERRIDE, 10)
  : null;

if (nonce !== null) {
  console.log('Initial nonce:', nonce);
}

function overrides(options?: DeployProxyOptions): DeployProxyOptions {
  if (!options) {
    options = {};
  }
  if (nonce !== null) {
    options.nonce = nonce++;
  }
  return options;
}

async function retry<Result>(action: () => Promise<Result>): Promise<Result> {
  let attempts = parseInt(process.env.EXALOTTO_DEPLOYMENT_ATTEMPTS!, 10);
  while (attempts-- !== 0) {
    try {
      return await action();
    } catch (e) {
      console.error(e);
      console.log('Retrying...');
    }
  }
  throw new Error(`action failed after ${process.env.EXALOTTO_DEPLOYMENT_ATTEMPTS} attempts`);
}

export async function deploy<Contract extends BaseContract>(
  name: string,
  args: any[] = [],
  libraries = {},
): Promise<Contract> {
  return await retry(async () => {
    const factory = await ethers.getContractFactory(name, { libraries });
    const contract = (await factory.deploy(...args, overrides())) as Contract;
    await contract.waitForDeployment();
    const transaction = contract.deploymentTransaction()!;
    await transaction.wait(~~process.env.EXALOTTO_CONFIRMATIONS!);
    console.log(`${name} deployed to: ${await contract.getAddress()} -- txid ${transaction.hash}`);
    return contract;
  });
}

export async function deployWithProxy<Contract extends BaseContract>(
  name: string,
  args: any[] = [],
  libraries?: Libraries,
): Promise<Contract> {
  return await retry(async () => {
    const factory = await ethers.getContractFactory(name, {
      libraries: libraries || {},
    });
    const contract = (await upgrades.deployProxy(
      factory,
      args,
      overrides({
        unsafeAllowLinkedLibraries: !!libraries,
      }),
    )) as Contract;
    await contract.waitForDeployment();
    const transaction = contract.deploymentTransaction()!;
    await transaction.wait(~~process.env.EXALOTTO_CONFIRMATIONS!);
    console.log(`${name} deployed to: ${await contract.getAddress()} -- txid ${transaction.hash}`);
    return contract;
  });
}

export async function attach<Contract extends BaseContract>(
  name: string,
  address: string,
): Promise<Contract> {
  const factory = await ethers.getContractFactory(name);
  return factory.attach(address) as Contract;
}

export async function sendOnce<Contract extends BaseContract>(
  contract: Contract,
  method: keyof Contract,
  ...args: any[]
) {
  const transaction = await (contract[method] as ContractMethod)(...args);
  await transaction.wait(~~process.env.EXALOTTO_CONFIRMATIONS!);
  return transaction;
}

export async function send<Contract extends BaseContract>(
  contract: Contract,
  method: keyof Contract,
  ...args: any[]
): Promise<Transaction> {
  return await retry(async () => {
    const transaction = await (contract[method] as ContractMethod)(...args);
    await transaction.wait(~~process.env.EXALOTTO_CONFIRMATIONS!);
    return transaction;
  });
}

export async function readLine(prompt: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise(resolve => {
    rl.question(prompt, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

export async function getDefaultSigner(): Promise<Signer> {
  const signers = await ethers.getSigners();
  if (!signers.length) {
    throw new Error('no signers');
  }
  return signers[0];
}
