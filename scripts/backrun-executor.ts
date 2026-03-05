import { ethers } from "ethers";
import * as database from "./database.ts";
import * as flashloan from "./flashloan.ts";
import * as approvalManager from "./approval-manager.ts";
import * as gasEstimator from "./gas-estimator.ts";

/**
 * Improved backrun executor
 * Crafts optimized swap transactions instead of just copying with higher gas
 */

export interface BackrunParams {
  txHash: string;
  dexRouter: string;
  functionSelector: string;
  path: string[];
  amountIn: bigint;
  amountOutMin: bigint;
  walletAddress: string;
  gasPrice: bigint;
}

/**
 * Execute a backrun via smart contract (flash loan + atomic swap)
 */
export async function executeBackrun(
  wallet: ethers.Wallet,
  params: BackrunParams
): Promise<string | null> {
  try {
    const contractAddress = process.env.BACKRUN_CONTRACT;
    if (!contractAddress) {
      console.warn(`   ⚠️  BACKRUN_CONTRACT not set in .env. Deploy and set contract address.`);
      database.recordBackrunFailed(params.txHash, "Smart contract not configured");
      return null;
    }

    console.log(`🚀 Backrunning ${params.txHash.slice(0, 10)}...`);

    // Record the backrun attempt in DB
    database.recordBackrunAttempt(params.txHash, "TBD", "TBD");

    // Load the contract
    const BackrunExecutor = new ethers.Contract(
      contractAddress,
      BACKRUN_EXECUTOR_ABI,
      wallet
    );

    // Estimate gas for the flash loan + backrun call
    const gasEstimate = await wallet.provider!.estimateGas({
      to: contractAddress,
      data: BackrunExecutor.interface.encodeFunctionData("executeBackrun", [
        params.path[0], // tokenToBorrow
        params.amountIn, // amountToBorrow
        params.path, // swap path
        params.amountOutMin, // amountOutMin
      ]),
      from: wallet.address,
    });

    const gasPrice = await gasEstimator.getGasPrice(wallet.provider!);

    // Calculate potential profit
    const estimatedGasCost = gasEstimate * gasPrice;
    const profitCalc = gasEstimator.calculateBackrunProfit(
      params.amountIn,
      0.75, // assume 0.75% capturable impact
      estimatedGasCost
    );

    console.log(
      `   💰 Est. gas: ${ethers.formatEther(estimatedGasCost)} MATIC | Est. profit: ${ethers.formatEther(profitCalc.netProfit)} MATIC`
    );

    // Check if profitable
    if (profitCalc.netProfit <= 0n) {
      database.recordBackrunFailed(params.txHash, "Not profitable after gas costs");
      console.warn(`   ⚠️  Skipping: profit too low`);
      return null;
    }

    // Send the backrun transaction
    console.log(`   📤 Sending backrun via smart contract...`);
    const tx = await BackrunExecutor.executeBackrun(
      params.path[0],
      params.amountIn,
      params.path,
      params.amountOutMin,
      {
        gasLimit: gasEstimate + (gasEstimate / 10n), // +10% buffer
        gasPrice,
      }
    );

    console.log(`   ✅ Backrun TX sent: ${tx.hash}`);
    database.recordBackrunSent(params.txHash, tx.hash);

    // Wait for confirmation (optional, for tracking)
    // const receipt = await tx.wait();
    // if (receipt?.status === 1) {
    //   database.recordBackrunConfirmed(tx.hash, receipt.blockNumber, receipt.gasUsed.toString(), "TBD profit");
    // }

    return tx.hash;
  } catch (e: any) {
    console.warn(`   ⚠️  Backrun failed: ${e.message || e}`);
    database.recordBackrunFailed(params.txHash, e.message || String(e));
    return null;
  }
}

/**
 * BackrunExecutor contract ABI (minimal)
 */
const BACKRUN_EXECUTOR_ABI = [
  "function executeBackrun(address tokenToBorrow, uint256 amountToBorrow, address[] calldata path, uint256 amountOutMin) external",
  "function getAvailableLiquidity(address token) external view returns (uint256)",
  "event BackrunExecuted(address indexed token, uint256 amountBorrowed, uint256 amountRepaid, uint256 profit)",
  "event SwapExecuted(address[] indexed path, uint256 amountIn, uint256 amountOut)",
];

