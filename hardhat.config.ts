import "dotenv/config";
import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],

  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },

  networks: {
    // 🔥 Ethereum fork (optional)
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
      accounts: {
        mnemonic: "test test test test test test test test test test test junk",
      },
      forking: {
        url: configVariable("MAINNET_RPC_URL"),
        blockNumber: process.env.FORK_BLOCK_NUMBER
          ? parseInt(process.env.FORK_BLOCK_NUMBER)
          : undefined,
      },
    },

    // 🔥 POLYGON FORK (THIS IS WHAT YOU WANT)
    hardhatPolygon: {
      type: "edr-simulated",
      chainType: "l1",

      // 👇 THIS FIXES INSUFFICIENT FUNDS
      accounts: {
        mnemonic: "test test test test test test test test test test test junk",
      },

      forking: {
        url:
          process.env.POLYGON_RPC_URL ||
          process.env.ALCHEMY_HTTP_URL ||
          "",
        blockNumber: process.env.FORK_BLOCK_NUMBER
          ? parseInt(process.env.FORK_BLOCK_NUMBER)
          : undefined,
      },
    },

    // Optional OP fork
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
    },

    // Sepolia testnet
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: process.env.SEPOLIA_PRIVATE_KEY
        ? [process.env.SEPOLIA_PRIVATE_KEY]
        : [],
    },

    // 🚨 REAL POLYGON (ONLY USE WHEN READY)
    polygon: {
      type: "http",
      chainType: "l1",
      url:
        process.env.ALCHEMY_HTTP_URL ||
        process.env.POLYGON_RPC_URL ||
        "https://polygon-rpc.com",
      accounts: process.env.PRIVATE_KEY
        ? [process.env.PRIVATE_KEY]
        : [],
    },
  },
});