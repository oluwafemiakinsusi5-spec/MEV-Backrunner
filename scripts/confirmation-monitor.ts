import { ethers } from "ethers";
import * as db from "./database.ts";

const polygonRPC = process.env.ALCHEMY_WS_URL || "";

let provider: ethers.WebSocketProvider;
let monitoringActive = false;

interface ConfirmationResult {
  blockNumber: number;
  transactionHash: string;
  status: "success" | "failed";
  gasUsed: string;
  actualAmountOut?: string;
  actualImpact?: number;
}

export async function initializeConfirmationMonitor() {
  if (!polygonRPC) {
    console.error("❌ ALCHEMY_WS_URL not set");
    return;
  }

  provider = new ethers.WebSocketProvider(polygonRPC);

  // Test connection
  try {
    const network = await provider.getNetwork();
    console.log(`✅ Connected to Polygon (Chain: ${network.chainId})`);
  } catch (error) {
    console.error("❌ Failed to connect to provider:", error);
    return;
  }

  monitoringActive = true;
  startMonitoring();
}

function startMonitoring() {
  console.log("🔍 Starting confirmation monitor...");

  // Listen to new blocks
  provider.on("block", async (blockNumber) => {
    try {
      const unconfirmed = db.getUnconfirmedSwaps();

      if (unconfirmed.length === 0) return;

      for (const swap of unconfirmed) {
        try {
          const receipt = await provider.getTransactionReceipt(swap.txHash);

          if (receipt) {
            console.log(`✅ Confirmed TX: ${swap.txHash.slice(0, 10)}... in block ${receipt.blockNumber}`);

            // Update confirmation timestamp
            const confirmedAtMs = Date.now();
            db.updateSwapConfirmation(swap.txHash, receipt.blockNumber, confirmedAtMs);

            // Try to extract actual amountOut and calculate impact
            try {
              const result = await extractActualAmountOut(swap, receipt);
              if (result) {
                db.updateSwapPnL(swap.txHash, result.actualAmountOut, result.actualImpact, result.pnL);
                console.log(`📊 PnL calculated for ${swap.txHash.slice(0, 10)}...`);
              }
            } catch (error) {
              console.warn(`⚠️  Could not extract amountOut for ${swap.txHash.slice(0, 10)}...`);
            }
          }
        } catch (error) {
          console.error(`Error checking TX ${swap.txHash}:`, error);
        }
      }
    } catch (error) {
      console.error("Error in block monitor:", error);
    }
  });

  // Handle disconnection
  (provider as any).websocket?.on("close", () => {
    console.warn("⚠️  Confirmation monitor disconnected");
    monitoringActive = false;
    if (provider) provider.removeAllListeners();
  });
}

async function extractActualAmountOut(
  swap: db.SwapRecord,
  receipt: ethers.TransactionReceipt
): Promise<{ actualAmountOut: string; actualImpact: number; pnL: string } | null> {
  try {
    // Fetch full transaction
    const tx = await provider.getTransaction(swap.txHash);
    if (!tx) return null;

    // Parse the transaction data to extract amountOut
    // This is contract-specific; for Uniswap V2 swaps, we look for Transfer events
    // For now, use a simplified approach: check logs for token transfers

    const iface = new ethers.Interface([
      "event Transfer(address indexed from, address indexed to, uint256 value)",
    ]);

    let actualAmountOut = "0";

    for (const log of receipt.logs || []) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed && parsed.name === "Transfer") {
          // This is a token transfer; the last one in the logs is likely the output token
          actualAmountOut = parsed.args[2].toString();
        }
      } catch (e) {
        // Not a Transfer event, skip
      }
    }

    if (actualAmountOut === "0") return null;

    // Calculate actual impact (slippage)
    // Slippage = (expected - actual) / expected * 100
    // Positive slippage means we got less than expected (loss)
    const amountInBN = BigInt(swap.amountIn);
    const actualAmountOutBN = BigInt(actualAmountOut);

    // For Uniswap V2: predictedAmountOut = amountIn * 997 * reserveOut / (reserveIn * 1000 + amountIn * 997)
    // This is simplified; ideally you'd re-simulate with actual reserves
    // For now, we'll use the predicted impact difference

    let expectedOutput = amountInBN; // placeholder
    if (swap.predictedImpact !== null) {
      // Reverse-engineer expected output from predicted impact
      // predictedImpact is positive for positive slippage (loss)
      // So: expectedOutput = actualAmountOut / (1 - impact/100)
      const impactFactor = 1 - (swap.predictedImpact / 100);
      if (impactFactor > 0) {
        expectedOutput = (actualAmountOutBN * BigInt(10000)) / BigInt(Math.floor(impactFactor * 10000));
      }
    }

    // Calculate slippage: (expected - actual) / expected * 100
    // If actual < expected, slippage is positive (we lost money)
    const slippageAmount = expectedOutput > actualAmountOutBN ? expectedOutput - actualAmountOutBN : BigInt(0);
    const actualImpact = expectedOutput > 0 ? Number((slippageAmount * BigInt(10000)) / expectedOutput) / 100 : 0;

    // Calculate PnL (very simplified; actual PnL requires price oracle)
    // Positive PnL = profit, Negative PnL = loss
    const pnL = (actualAmountOutBN - expectedOutput).toString();

    return {
      actualAmountOut,
      actualImpact,
      pnL,
    };
  } catch (error) {
    console.error("Error extracting actual amount out:", error);
    return null;
  }
}

export async function stopConfirmationMonitor() {
  if (provider) {
    provider.removeAllListeners();
    (provider as any).websocket?.close?.();
  }
  monitoringActive = false;
  console.log("🛑 Confirmation monitor stopped");
}

export function isMonitoring(): boolean {
  return monitoringActive;
}
