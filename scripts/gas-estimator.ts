import { ethers } from "ethers";

/**
 * Gas Estimation & Transaction Simulation
 * Estimates gas costs and validates transactions before sending
 */

export interface GasEstimate {
  gasLimit: bigint;
  gasPrice: bigint;
  estimatedCost: bigint; // in wei
  estimatedCostUsd: number; // rough USD estimate
}

const GAS_PRICE_CACHE = {
  lastUpdate: 0,
  estimate: 0n,
};
const CACHE_DURATION = 30000; // 30 seconds

/**
 * Get current gas price with caching
 */
export async function getGasPrice(provider: ethers.Provider): Promise<bigint> {
  const now = Date.now();
  if (now - GAS_PRICE_CACHE.lastUpdate < CACHE_DURATION && GAS_PRICE_CACHE.estimate > 0n) {
    return GAS_PRICE_CACHE.estimate;
  }

  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice || 50000000000n; // 50 gwei fallback

  GAS_PRICE_CACHE.estimate = gasPrice;
  GAS_PRICE_CACHE.lastUpdate = now;

  return gasPrice;
}

/**
 * Estimate gas for a swap transaction
 * Returns estimate + cost in wei
 */
export async function estimateSwapGas(
  provider: ethers.Provider,
  txRequest: ethers.TransactionRequest,
  wallet: ethers.Wallet
): Promise<GasEstimate> {
  try {
    // Try to simulate the transaction to get actual gas usage
    const gasLimit = await provider.estimateGas({
      ...txRequest,
      from: wallet.address,
    });

    const gasPrice = await getGasPrice(provider);
    const estimatedCost = gasLimit * gasPrice;

    // Rough USD estimate: assume MATIC price ~$1 (adjust as needed)
    const gasCostInMatic = Number(ethers.formatEther(estimatedCost));
    const estimatedCostUsd = gasCostInMatic; // 1 MATIC ≈ $1

    return {
      gasLimit: gasLimit + (gasLimit / 10n), // Add 10% buffer
      gasPrice,
      estimatedCost,
      estimatedCostUsd,
    };
  } catch (error) {
    // Fallback estimates
    console.warn(`   ⚠️  Gas estimation failed: ${error}. Using fallback.`);
    const gasPrice = await getGasPrice(provider);
    const fallbackGasLimit = 200000n;
    const estimatedCost = fallbackGasLimit * gasPrice;

    return {
      gasLimit: fallbackGasLimit,
      gasPrice,
      estimatedCost,
      estimatedCostUsd: Number(ethers.formatEther(estimatedCost)),
    };
  }
}

/**
 * Calculate expected profit from a backrun
 * profit = (output at inflated price) - gas cost
 */
export function calculateBackrunProfit(
  amountIn: bigint,
  predictedImpactPercent: number,
  gasEstimateCostWei: bigint,
  tokenDecimals: number = 18
): {
  theoreticalOutput: bigint;
  gasCost: bigint;
  netProfit: bigint;
  profitMargin: number;
  profitable: boolean;
} {
  // Simplified: assume we can capture 50% of the victim's price improvement
  const capturablePercent = predictedImpactPercent * 0.5;

  // Use BigInt for precision - work in raw token units
  // Calculate the impact as a fraction: impact * 0.5 / 100
  const impactMultiplier = BigInt(Math.floor(capturablePercent * 100)); // e.g., 0.375% -> 37
  const divisor = BigInt(10000); // For percentage calculation with 2 decimal places

  // Calculate output boost in raw units to avoid floating point
  // outputBoost = amountIn * impactMultiplier / divisor
  const outputBoostWei = (amountIn * impactMultiplier) / divisor;

  const netProfit = outputBoostWei > gasEstimateCostWei ? outputBoostWei - gasEstimateCostWei : BigInt(0);

  const profitMargin =
    outputBoostWei > 0n ? Number((netProfit * 10000n) / outputBoostWei) / 100 : 0;

  return {
    theoreticalOutput: outputBoostWei,
    gasCost: gasEstimateCostWei,
    netProfit,
    profitMargin,
    profitable: netProfit > 0n,
  };
}

/**
 * Check if backrun is profitable after gas costs
 */
export function isProfitable(
  amountIn: bigint,
  impactPercent: number,
  gasEstimateCost: bigint
): boolean {
  const profit = calculateBackrunProfit(amountIn, impactPercent, gasEstimateCost);
  return profit.netProfit > BigInt(0);
}
