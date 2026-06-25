import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";
import { HardhatUserConfig } from "hardhat/config";

const authorityPrivateKey = process.env.PRIVATE_KEY_AUTORIDAD;
const sepoliaRpcUrl = process.env.ALCHEMY_RPC_URL?.trim();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {},
    sepolia: {
      url: sepoliaRpcUrl || "https://eth-sepolia.g.alchemy.com/v2/placeholder",
      chainId: 11155111,
      accounts: authorityPrivateKey ? [authorityPrivateKey] : []
    }
  },
  etherscan: {
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY || ""
    }
  },
  mocha: {
    timeout: 60000
  }
};

export default config;
