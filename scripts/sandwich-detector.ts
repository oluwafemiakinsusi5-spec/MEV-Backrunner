import { ethers, TransactionResponse } from "ethers";

/**
 * Sandwich Detection Module
 * Detects if a MEV opportunity is already being targeted by other bots
 * Helps avoid gas wars and failed transactions
 */

// Known MEV botEOAs on Polygon (top sandwichers - can be expanded)
const KNOWN_MEV_BOTS = new Set([
  "0xc9b310f3c53d7d6ed0a7b3d5a2e7e5f3a3e5a3e", // Example - add real sandwichers
]);

// Track pending opportunities we've seen
const PENDING_OPPORTUNITIES = new Map<string, {
  txHash: string;
  detectedAt: number;
  competitorCount: number;
}>();

const OPPORTUNITY_TTL_MS = 30000; // 30 seconds

// Swap function selectors for detection
const SWAP_SELECTORS = [
  "0x38ed1739", // swapExactTokensForTokens
  "0x8803dbee", // swapTokensForExactTokens
  "0x414bf389", // exactInputSingle
  "0xc04b8d59", // exactInput
];

/**
 * Check if a transaction is from a known MEV bot
 */
export function isKnownMevBot(address: string): boolean {
  return KNOWN_MEV_BOTS.has(address.toLowerCase());
}

/**
 * Check if transaction data contains a swap function
 */
function isSwapTransaction(data: string): boolean {
  if (!data || data.length < 10) return false;
  const selector = data.substring(0, 10);
  return SWAP_SELECTORS.includes(selector);
}

/**
 * Process a transaction to check if it's a competitor
 */
function checkIfCompetitor(tx: TransactionResponse, dexRouter: string): boolean {
  if (!tx.to) return false;
  if (tx.to.toLowerCase() !== dexRouter.toLowerCase()) return false;
  if (!tx.data) return false;
  if (!isSwapTransaction(tx.data)) return false;
  
  // Check if from known MEV bot
  if (isKnownMevBot(tx.from)) return true;
  
  // Different sender - potential competitor
  return tx.from.toLowerCase() !== tx.to.toLowerCase();
}

/**
 * Detect if a pending transaction has competing backrunners
 * Looks for transactions to the same DEX router with similar parameters
 */
export async function detectCompetitors(
  provider: ethers.Provider,
  victimTxHash: string,
  path: string[],
  amountIn: bigint,
  dexRouter: string,
  blockNumber?: number
): Promise<{
  hasCompetitors: boolean;
  competitorCount: number;
  recommendation: "proceed" | "skip" | "wait";
}> {
  try {
    // First, check the mempool for pending transactions to the same DEX
    // This is more relevant for MEV opportunities than confirmed blocks
    const currentBlock = await provider.getBlockNumber();
    
    // Check recent pending transactions via block transactions
    // Note: ethers v6 doesn't have direct pending tx access, so we check recent blocks
    let competitorCount = 0;
    
    // Check the last few blocks for similar transactions
    const searchRange = Math.min(3, currentBlock - Math.max(0, (blockNumber || currentBlock) - 1));
    
    for (let i = 0; i < searchRange; i++) {
      const blockNum = currentBlock - i;
      try {
        const block = await provider.getBlock(blockNum, true);
        if (!block || !block.transactions) continue;
        
        for (const txOrHash of block.transactions) {
          let tx: TransactionResponse | null = null;
          
          if (typeof txOrHash === "string") {
            try {
              tx = await provider.getTransaction(txOrHash);
            } catch {
              continue;
            }
          } else {
            tx = txOrHash as TransactionResponse;
          }
          
          if (!tx) continue;
          
          if (checkIfCompetitor(tx, dexRouter)) {
            competitorCount++;
          }
        }
      } catch {
        // Block might not be available, skip
        continue;
      }
    }

    const hasCompetitors = competitorCount > 0;
    
    let recommendation: "proceed" | "skip" | "wait";
    if (competitorCount === 0) {
      recommendation = "proceed";
    } else if (competitorCount >= 3) {
      recommendation = "skip";
    } else {
      recommendation = "wait";
    }

    return {
      hasCompetitors,
      competitorCount,
      recommendation,
    };
  } catch (error) {
    console.warn(`⚠️  Error detecting competitors: ${error}`);
    // On error, be conservative and recommend waiting
    return {
      hasCompetitors: false,
      competitorCount: 0,
      recommendation: "wait",
    };
  }
}

/**
 * Track an opportunity we're pursuing
 */
export function trackOpportunity(txHash: string): void {
  PENDING_OPPORTUNITIES.set(txHash.toLowerCase(), {
    txHash: txHash.toLowerCase(),
    detectedAt: Date.now(),
    competitorCount: 0,
  });
}

/**
 * Mark competitor found for an opportunity
 */
export function markCompetitorFound(txHash: string): void {
  const opp = PENDING_OPPORTUNITIES.get(txHash.toLowerCase());
  if (opp) {
    opp.competitorCount++;
  }
}

/**
 * Remove opportunity from tracking
 */
export function removeOpportunity(txHash: string): void {
  PENDING_OPPORTUNITIES.delete(txHash.toLowerCase());
}

/**
 * Check if we're already pursuing an opportunity
 */
export function isOpportunityBeingPursued(txHash: string): boolean {
  const opp = PENDING_OPPORTUNITIES.get(txHash.toLowerCase());
  if (!opp) return false;
  
  if (Date.now() - opp.detectedAt > OPPORTUNITY_TTL_MS) {
    PENDING_OPPORTUNITIES.delete(txHash.toLowerCase());
    return false;
  }
  
  return true;
}

/**
 * Clean up expired opportunities
 */
export function cleanupExpiredOpportunities(): number {
  let cleaned = 0;
  const now = Date.now();
  
  for (const [hash, opp] of PENDING_OPPORTUNITIES) {
    if (now - opp.detectedAt > OPPORTUNITY_TTL_MS) {
      PENDING_OPPORTUNITIES.delete(hash);
      cleaned++;
    }
  }
  
  return cleaned;
}

/**
 * Simulate a transaction to check if it will succeed
 */
export async function simulateTransaction(
  provider: ethers.Provider,
  tx: ethers.TransactionRequest
): Promise<{
  success: boolean;
  reason?: string;
}> {
  try {
    const result = await provider.call(tx);
    
    if (result === "0x" || result === "0x0000000000000000000000000000000000000000000000000000000000000000") {
      return { success: true };
    }
    
    if (result.startsWith("0x08c379a0")) {
      return { success: false, reason: "Execution reverted" };
    }
    
    return { success: true };
  } catch (error: any) {
    let reason = "Simulation failed";
    if (error.message.includes("revert")) {
      reason = error.message;
    }
    return { success: false, reason };
  }
}

/**
 * Estimate optimal gas price to outcompete competitors
 */
export async function estimateCompetitiveGasPrice(
  _provider: ethers.Provider,
  currentGasPrice: bigint,
  competitorCount: number
): Promise<bigint> {
  let multiplier = 1.1;
  
  if (competitorCount >= 3) {
    multiplier = 1.3;
  } else if (competitorCount >= 1) {
    multiplier = 1.2;
  }
  
  const competitiveGasPrice = (currentGasPrice * BigInt(Math.floor(multiplier * 100))) / 100n;
  
  const MAX_GAS_PRICE = 500n * 1_000_000_000n;
  return competitiveGasPrice > MAX_GAS_PRICE ? MAX_GAS_PRICE : competitiveGasPrice;
}
