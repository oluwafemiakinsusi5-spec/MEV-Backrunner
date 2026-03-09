#!/usr/bin/env node
/**
 * Emergency Fund Recovery Script
 *
 * Checks contract balance and withdraws stuck tokens
 * Run: npx ts-node scripts/emergency-recovery.ts
 */

import { ethers } from "ethers";
import "dotenv/config";
import { loadSecret } from "./secrets-loader.ts";

const BACKRUN_CONTRACT = process.env.BACKRUN_CONTRACT || "0x607de6c88F3a7DEF0a2F5A960F489DAdF22eF2b7";
const RPC_URL = process.env.ALCHEMY_HTTP_URL || "https://polygon-mainnet.g.alchemy.com/v2/";

// Common tokens on Polygon
const TOKENS = {
  WMATIC: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
  USDC: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
  USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
  WETH: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
};

const CONTRACT_ABI = [
  "function owner() view returns (address)",
  "function withdraw(address token, uint256 amount) external",
  "function paused() view returns (bool)",
  "function getAvailableLiquidity(address token) view returns (uint256)",
  "event BackrunExecuted(address indexed token, uint256 amountBorrowed, uint256 amountRepaid, uint256 profit)",
];

async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║         🚨 EMERGENCY FUND RECOVERY - MEV BOT CONTRACT       ║
║                                                              ║
║  ⚠️  USE WITH CAUTION - This script withdraws funds from     ║
║     your BackrunExecutor contract                            ║
╚════════════════════════════════════════════════════════════╝
  `);

  // Check if we have a private key
  const privateKey = loadSecret("PRIVATE_KEY");
  if (!privateKey) {
    console.error("❌ No private key found. Run: npx ts-node scripts/init-secrets.ts");
    console.error("   Or set PRIVATE_KEY in .env (temporarily)");
    process.exit(1);
  }

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log(`🔑 Using wallet: ${wallet.address}`);
  console.log(`📍 Contract: ${BACKRUN_CONTRACT}`);
  console.log(`🌐 Network: Polygon Mainnet`);
  console.log();

  // Connect to contract
  const contract = new ethers.Contract(BACKRUN_CONTRACT, CONTRACT_ABI, wallet);

  try {
    // Check contract owner
    const owner = await contract.owner();
    console.log(`👤 Contract owner: ${owner}`);

    if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
      console.error(`❌ You are not the contract owner!`);
      console.error(`   Contract owner: ${owner}`);
      console.error(`   Your wallet:    ${wallet.address}`);
      console.error(`   Cannot withdraw funds.`);
      process.exit(1);
    }

    // Check if contract is paused
    const isPaused = await contract.paused();
    console.log(`⏸️  Contract paused: ${isPaused}`);

    if (isPaused) {
      console.log(`⚠️  Contract is paused. Withdrawals may be blocked.`);
    }

    console.log(`\n💰 Checking contract balances...\n`);

    // Check balances for common tokens
    let totalValue = 0n;
    const balances: { [key: string]: bigint } = {};

    for (const [symbol, address] of Object.entries(TOKENS)) {
      try {
        const tokenContract = new ethers.Contract(
          address,
          ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"],
          provider
        );

        const balance = await tokenContract.balanceOf(BACKRUN_CONTRACT);
        const decimals = await tokenContract.decimals();

        if (balance > 0n) {
          balances[symbol] = balance;
          const formatted = ethers.formatUnits(balance, decimals);
          console.log(`✅ ${symbol}: ${formatted} (${balance.toString()} wei)`);

          // Rough USD estimation (very approximate)
          if (symbol === "USDC" || symbol === "USDT") {
            totalValue += balance / (10n ** BigInt(decimals));
          }
        }
      } catch (error) {
        console.log(`❌ ${symbol}: Error checking balance`);
      }
    }

    // Check ETH/MATIC balance
    const ethBalance = await provider.getBalance(BACKRUN_CONTRACT);
    if (ethBalance > 0n) {
      balances["MATIC"] = ethBalance;
      console.log(`✅ MATIC: ${ethers.formatEther(ethBalance)} (${ethBalance.toString()} wei)`);
    }

    if (Object.keys(balances).length === 0) {
      console.log(`💸 No funds found in contract.`);
      return;
    }

    console.log(`\n🔄 Ready to withdraw funds to: ${wallet.address}`);
    console.log(`\n⚠️  WITHDRAWAL OPTIONS:`);

    let option = 1;
    for (const [symbol, balance] of Object.entries(balances)) {
      console.log(`   ${option}. Withdraw all ${symbol} (${ethers.formatUnits(balance, symbol === "MATIC" ? 18 : 6)})`);
      option++;
    }

    console.log(`   ${option}. Withdraw ALL tokens`);
    console.log(`   0. Cancel (do nothing)`);

    // For now, let's create withdrawal functions but require manual confirmation
    console.log(`\n🛑 MANUAL CONFIRMATION REQUIRED`);
    console.log(`\nTo withdraw funds, you need to call the contract directly.`);
    console.log(`Here are the commands to run in a Node.js REPL:`);

    for (const [symbol, balance] of Object.entries(balances)) {
      const tokenAddress = symbol === "MATIC" ? ethers.ZeroAddress : TOKENS[symbol as keyof typeof TOKENS];

      console.log(`\n// Withdraw ${symbol}:`);
      console.log(`contract.withdraw("${tokenAddress}", "${balance.toString()}")`);
    }

    console.log(`\n⚠️  IMPORTANT:`);
    console.log(`   • Make sure you have enough MATIC for gas fees`);
    console.log(`   • Test with small amounts first if possible`);
    console.log(`   • Monitor the transaction on PolygonScan`);
    console.log(`   • After withdrawal, consider self-destructing the contract`);

  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
    console.error(`\n💡 Possible issues:`);
    console.error(`   • Contract not deployed at this address`);
    console.error(`   • Network connectivity issues`);
    console.error(`   • You don't have permission to withdraw`);
  }
}

main().catch(console.error);