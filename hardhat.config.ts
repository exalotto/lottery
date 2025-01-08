import { HardhatUserConfig } from 'hardhat/config';

import dotenv from 'dotenv';

import '@nomicfoundation/hardhat-toolbox';
import '@nomiclabs/hardhat-solhint';

import '@openzeppelin/hardhat-upgrades';
import 'hardhat-contract-sizer';
import 'hardhat-gas-reporter';

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.26',
    settings: {
      debug: {
        revertStrings: 'strip',
      },
      optimizer: {
        enabled: true,
        runs: 1000000,
      },
    },
  },
  networks: {
    mainnet: {
      url: 'https://eth.public-rpc.com',
      accounts: process.env.EXALOTTO_DEPLOYER ? [process.env.EXALOTTO_DEPLOYER] : [],
    },
    matic: {
      url: 'https://polygon-rpc.com',
      accounts: process.env.EXALOTTO_DEPLOYER ? [process.env.EXALOTTO_DEPLOYER] : [],
    },
    zkevm: {
      url: 'https://zkevm-rpc.com',
      accounts: process.env.EXALOTTO_DEPLOYER ? [process.env.EXALOTTO_DEPLOYER] : [],
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: 'USD',
  },
  etherscan: {
    apiKey: process.env.HARDHAT_BLOCK_EXPLORER_API_KEY!,
  },
  mocha: {
    timeout: 0,
  },
};

export default config;
