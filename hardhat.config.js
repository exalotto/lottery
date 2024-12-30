require('@nomicfoundation/hardhat-toolbox');
require('@openzeppelin/hardhat-upgrades');
require('hardhat-contract-sizer');
require('hardhat-gas-reporter');

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
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
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: 'USD',
  },
  etherscan: {
    apiKey: {
      polygon: process.env.HARDHAT_ETHERSCAN_API_KEY,
    },
  },
  mocha: {
    timeout: 0,
  },
};
