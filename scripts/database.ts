import initSqlJs from "sql.js";
export type SqlJsDatabase = any;
import * as fs from "fs";
import * as path from "path";

let SQL: any;
let db: SqlJsDatabase;

const dbPath = path.join(process.cwd(), "mev_tracker.sqlite");

// Batch write configuration
let pendingWrites: Array<() => void> = [];
let saveInterval: NodeJS.Timeout | null = null;
const SAVE_INTERVAL_MS = 10000; // Save every 10 seconds
const BATCH_SIZE = 10; // Process up to 10 writes per interval

export interface SwapRecord {
  id?: number;
  txHash: string;
  blockNumber: number | null;
  dexName: string;
  functionName: string;
  fromAddress: string;
  toAddress: string;
  tokenA: string;
  tokenB: string;
  amountIn: string;
  predictedImpact: number | null;
  gasPrice: string;
  gasLimit: string;
  detectedAt: number;
  confirmedAt: number | null;
  actualAmountOut: string | null;
  actualImpact: number | null;
  actualPnL: string | null;
}

export async function initializeDatabase() {
  SQL = await initSqlJs();

  // Try to load existing database from disk
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS swaps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      txHash TEXT UNIQUE NOT NULL,
      blockNumber INTEGER,
      dexName TEXT,
      functionName TEXT,
      fromAddress TEXT,
      toAddress TEXT,
      tokenA TEXT,
      tokenB TEXT,
      amountIn TEXT,
      predictedImpact REAL,
      gasPrice TEXT,
      gasLimit TEXT,
      detectedAt INTEGER NOT NULL,
      confirmedAt INTEGER,
      actualAmountOut TEXT,
      actualImpact REAL,
      actualPnL TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS backruns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      originalTxHash TEXT NOT NULL,
      backrunTxHash TEXT UNIQUE,
      backrunStatus TEXT DEFAULT 'pending',
      sentAt INTEGER,
      confirmedAt INTEGER,
      blockNumber INTEGER,
      gasUsed TEXT,
      estimatedGasCost TEXT,
      estimatedProfit TEXT,
      actualProfit TEXT,
      successful INTEGER DEFAULT 0,
      errorMessage TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(originalTxHash) REFERENCES swaps(txHash)
    );

    CREATE INDEX IF NOT EXISTS idx_txHash ON swaps(txHash);
    CREATE INDEX IF NOT EXISTS idx_blockNumber ON swaps(blockNumber);
    CREATE INDEX IF NOT EXISTS idx_confirmedAt ON swaps(confirmedAt);
    CREATE INDEX IF NOT EXISTS idx_backrun_originalTx ON backruns(originalTxHash);
    CREATE INDEX IF NOT EXISTS idx_backrun_status ON backruns(backrunStatus);
  `);

  // Start periodic save interval
  saveInterval = setInterval(processPendingWrites, SAVE_INTERVAL_MS);
  
  saveDatabase();
}

/**
 * Queue a write operation to be processed in batch
 */
function queueWrite(writeFn: () => void): void {
  pendingWrites.push(writeFn);
  
  // If we have too many pending writes, process immediately
  if (pendingWrites.length >= BATCH_SIZE) {
    processPendingWrites();
  }
}

/**
 * Process all pending writes
 */
function processPendingWrites(): void {
  if (pendingWrites.length === 0) return;
  
  const writesToProcess = pendingWrites.splice(0, BATCH_SIZE);
  
  try {
    for (const writeFn of writesToProcess) {
      writeFn();
    }
    // Only save after batch is processed
    saveDatabase();
  } catch (error) {
    console.error("Error processing batch writes:", error);
    // Put writes back if failed
    pendingWrites.unshift(...writesToProcess);
  }
}

function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

export function insertSwap(swap: Omit<SwapRecord, "id">): number {
  // Get the current max id to calculate the next one
  const countResult = db.exec("SELECT COUNT(*) as count FROM swaps");
  const currentCount = countResult[0]?.values[0]?.[0] as number || 0;
  const nextId = currentCount + 1;
  
  // Use queueWrite for batch processing
  queueWrite(() => {
    db.run(
      `INSERT INTO swaps (
        txHash, blockNumber, dexName, functionName, fromAddress, toAddress,
        tokenA, tokenB, amountIn, predictedImpact, gasPrice, gasLimit,
        detectedAt, confirmedAt, actualAmountOut, actualImpact, actualPnL
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        swap.txHash,
        swap.blockNumber,
        swap.dexName,
        swap.functionName,
        swap.fromAddress,
        swap.toAddress,
        swap.tokenA,
        swap.tokenB,
        swap.amountIn,
        swap.predictedImpact,
        swap.gasPrice,
        swap.gasLimit,
        swap.detectedAt,
        swap.confirmedAt,
        swap.actualAmountOut,
        swap.actualImpact,
        swap.actualPnL,
      ]
    );
  });

  return nextId;
}

export function getSwapByHash(txHash: string): SwapRecord | null {
  const result = db.exec(
    "SELECT * FROM swaps WHERE txHash = ?",
    [txHash]
  );

  if (result.length === 0 || result[0].values.length === 0) return null;

  const columns = result[0].columns;
  const values = result[0].values[0];
  const swap: any = {};
  columns.forEach((col: string, idx: number) => {
    swap[col] = values[idx];
  });

  return swap as SwapRecord;
}

export function getUnconfirmedSwaps(): SwapRecord[] {
  const result = db.exec(
    "SELECT * FROM swaps WHERE confirmedAt IS NULL ORDER BY detectedAt DESC LIMIT 100"
  );

  if (result.length === 0) return [];

  const columns = result[0].columns;
  const swaps: SwapRecord[] = [];

  result[0].values.forEach((values: any) => {
    const swap: any = {};
    columns.forEach((col: string, idx: number) => {
      swap[col] = values[idx];
    });
    swaps.push(swap as SwapRecord);
  });

  return swaps;
}

export function updateSwapConfirmation(
  txHash: string,
  blockNumber: number,
  confirmedAt: number
) {
  // Use queueWrite for batch processing
  queueWrite(() => {
    db.run(
      "UPDATE swaps SET blockNumber = ?, confirmedAt = ? WHERE txHash = ?",
      [blockNumber, confirmedAt, txHash]
    );
  });
}

export function updateSwapPnL(
  txHash: string,
  actualAmountOut: string,
  actualImpact: number,
  pnL: string
) {
  // Use queueWrite for batch processing
  queueWrite(() => {
    db.run(
      "UPDATE swaps SET actualAmountOut = ?, actualImpact = ?, actualPnL = ? WHERE txHash = ?",
      [actualAmountOut, actualImpact, pnL, txHash]
    );
  });
}

export function getStats() {
  const totalResult = db.exec("SELECT COUNT(*) as count FROM swaps");
  const total = totalResult[0]?.values[0]?.[0] as number || 0;

  const confirmedResult = db.exec(
    "SELECT COUNT(*) as count FROM swaps WHERE confirmedAt IS NOT NULL"
  );
  const confirmed = confirmedResult[0]?.values[0]?.[0] as number || 0;

  const pnlResult = db.exec(`
    SELECT 
      COUNT(*) as count,
      AVG(CAST(actualPnL AS REAL)) as averagePnL,
      SUM(CAST(actualPnL AS REAL)) as totalPnL
    FROM swaps 
    WHERE actualPnL IS NOT NULL
  `);

  let avgPnL = 0;
  let totalPnL = 0;

  if (pnlResult.length > 0 && pnlResult[0].values.length > 0) {
    const values = pnlResult[0].values[0];
    avgPnL = (values[1] as number) || 0;
    totalPnL = (values[2] as number) || 0;
  }

  return {
    totalDetected: total,
    confirmed,
    avgPnL,
    totalPnL,
  };
}

/**
 * Flush all pending writes to disk immediately
 */
export function flushPendingWrites(): void {
  // Process all remaining writes
  while (pendingWrites.length > 0) {
    const writesToProcess = pendingWrites.splice(0, pendingWrites.length);
    try {
      for (const writeFn of writesToProcess) {
        writeFn();
      }
      saveDatabase();
    } catch (error) {
      console.error("Error flushing pending writes:", error);
      pendingWrites.unshift(...writesToProcess);
      break;
    }
  }
}

export function closeDatabase() {
  // Stop the save interval
  if (saveInterval) {
    clearInterval(saveInterval);
    saveInterval = null;
  }
  
  // Flush any pending writes
  flushPendingWrites();
  
  // Save and close
  saveDatabase();
  db.close();
}

// ===== Analytics helpers =====

export interface TokenPair {
  tokenA: string;
  tokenB: string;
  count: number;
}

export function getTopTokenPairs(limit: number): TokenPair[] {
  const result = db.exec(
    `SELECT tokenA, tokenB, COUNT(*) as count 
     FROM swaps 
     GROUP BY tokenA, tokenB 
     ORDER BY count DESC 
     LIMIT ?`,
    [limit]
  );

  if (result.length === 0) return [];

  const columns = result[0].columns;
  const pairs: TokenPair[] = [];

  result[0].values.forEach((values: any) => {
    const pair: any = {};
    columns.forEach((col: string, idx: number) => {
      pair[col] = values[idx];
    });
    pairs.push(pair as TokenPair);
  });

  return pairs;
}

export interface DexStat {
  dexName: string;
  count: number;
  avgImpact: number | null;
}

export function getDexStats(): DexStat[] {
  const result = db.exec(
    `SELECT dexName, COUNT(*) as count, AVG(predictedImpact) as avgImpact 
     FROM swaps 
     WHERE predictedImpact IS NOT NULL
     GROUP BY dexName 
     ORDER BY count DESC`
  );

  if (result.length === 0) return [];

  const columns = result[0].columns;
  const stats: DexStat[] = [];

  result[0].values.forEach((values: any) => {
    const stat: any = {};
    columns.forEach((col: string, idx: number) => {
      stat[col] = values[idx];
    });
    stats.push(stat as DexStat);
  });

  return stats;
}

export interface PnLBuckets {
  profitable: number;
  breakeven: number;
  loss: number;
}

export function getPnLDistribution(): PnLBuckets {
  const profitable = db.exec(
    `SELECT COUNT(*) as count FROM swaps WHERE actualPnL IS NOT NULL AND CAST(actualPnL AS REAL) > 0`
  );
  const profitableCount = profitable[0]?.values[0]?.[0] as number || 0;

  const breakeven = db.exec(
    `SELECT COUNT(*) as count FROM swaps WHERE actualPnL IS NOT NULL AND CAST(actualPnL AS REAL) = 0`
  );
  const breakevenCount = breakeven[0]?.values[0]?.[0] as number || 0;

  const loss = db.exec(
    `SELECT COUNT(*) as count FROM swaps WHERE actualPnL IS NOT NULL AND CAST(actualPnL AS REAL) < 0`
  );
  const lossCount = loss[0]?.values[0]?.[0] as number || 0;

  return {
    profitable: profitableCount,
    breakeven: breakevenCount,
    loss: lossCount,
  };
}

export function getRecentSwaps(limit: number): SwapRecord[] {
  const result = db.exec(
    `SELECT * FROM swaps ORDER BY detectedAt DESC LIMIT ?`,
    [limit]
  );

  if (result.length === 0) return [];

  const columns = result[0].columns;
  const swaps: SwapRecord[] = [];

  result[0].values.forEach((values: any) => {
    const swap: any = {};
    columns.forEach((col: string, idx: number) => {
      swap[col] = values[idx];
    });
    swaps.push(swap as SwapRecord);
  });

  return swaps;
}

// ===== Backrun tracking =====

export interface BackrunRecord {
  id?: number;
  originalTxHash: string;
  backrunTxHash: string | null;
  backrunStatus: "pending" | "sent" | "confirmed" | "failed";
  sentAt: number | null;
  confirmedAt: number | null;
  blockNumber: number | null;
  gasUsed: string | null;
  estimatedGasCost: string;
  estimatedProfit: string;
  actualProfit: string | null;
  successful: number;
  errorMessage: string | null;
}

export function recordBackrunAttempt(
  originalTxHash: string,
  estimatedGasCost: string,
  estimatedProfit: string
): number {
  // Use queueWrite for batch processing to ensure consistency
  queueWrite(() => {
    db.run(
      `INSERT INTO backruns (originalTxHash, backrunStatus, estimatedGasCost, estimatedProfit) VALUES (?, ?, ?, ?)`,
      [originalTxHash, "pending", estimatedGasCost, estimatedProfit]
    );
  });
  
  // Get the current max id to calculate the next one
  const countResult = db.exec("SELECT COUNT(*) as count FROM backruns");
  const currentCount = countResult[0]?.values[0]?.[0] as number || 0;
  return currentCount;
}

export function recordBackrunSent(
  originalTxHash: string,
  backrunTxHash: string
): void {
  // Use queueWrite for batch processing
  queueWrite(() => {
    db.run(
      `UPDATE backruns SET backrunTxHash = ?, backrunStatus = ?, sentAt = ? WHERE originalTxHash = ? AND backrunStatus = 'pending'`,
      [backrunTxHash, "sent", Date.now(), originalTxHash]
    );
  });
}

export function recordBackrunConfirmed(
  backrunTxHash: string,
  blockNumber: number,
  gasUsed: string,
  actualProfit: string
): void {
  // Use queueWrite for batch processing
  queueWrite(() => {
    db.run(
      `UPDATE backruns SET backrunStatus = ?, confirmedAt = ?, blockNumber = ?, gasUsed = ?, actualProfit = ?, successful = 1 WHERE backrunTxHash = ?`,
      ["confirmed", Date.now(), blockNumber, gasUsed, actualProfit, backrunTxHash]
    );
  });
}

export function recordBackrunFailed(
  originalTxHash: string,
  errorMessage: string
): void {
  // Use queueWrite for batch processing
  queueWrite(() => {
    db.run(
      `UPDATE backruns SET backrunStatus = ?, errorMessage = ? WHERE originalTxHash = ? AND backrunStatus IN ('pending', 'sent')`,
      ["failed", errorMessage, originalTxHash]
    );
  });
}

export function getBackrunStats() {
  const totalAttempts = db.exec("SELECT COUNT(*) as count FROM backruns");
  const total = totalAttempts[0]?.values[0]?.[0] as number || 0;

  const successful = db.exec("SELECT COUNT(*) as count FROM backruns WHERE successful = 1");
  const successCount = successful[0]?.values[0]?.[0] as number || 0;

  const profitResult = db.exec(
    `SELECT COUNT(*) as count, AVG(CAST(actualProfit AS REAL)) as avgProfit, SUM(CAST(actualProfit AS REAL)) as totalProfit FROM backruns WHERE actualProfit IS NOT NULL AND successful = 1`
  );
  const profitableCount = profitResult[0]?.values[0]?.[0] as number || 0;
  const avgProfit = (profitResult[0]?.values[0]?.[1] as number) || 0;
  const totalProfit = (profitResult[0]?.values[0]?.[2] as number) || 0;

  return {
    totalAttempts: total,
    successful: successCount,
    successRate: total > 0 ? ((successCount / total) * 100).toFixed(2) : "0",
    profitableCount,
    averageProfit: avgProfit,
    totalProfit,
  };
}

export function getRecentBackruns(limit: number): BackrunRecord[] {
  const result = db.exec(
    `SELECT * FROM backruns ORDER BY createdAt DESC LIMIT ?`,
    [limit]
  );

  if (result.length === 0) return [];

  const columns = result[0].columns;
  const backruns: BackrunRecord[] = [];

  result[0].values.forEach((values: any) => {
    const backrun: any = {};
    columns.forEach((col: string, idx: number) => {
      backrun[col] = values[idx];
    });
    backruns.push(backrun as BackrunRecord);
  });

  return backruns;
}
