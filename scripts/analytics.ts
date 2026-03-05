import * as database from "./database.ts";

/**
 * Analytics dashboard
 * Query the mev_tracker.sqlite database and generate statistics
 * Run: npx ts-node scripts/analytics.ts
 */

await database.initializeDatabase();

console.log(`
╔════════════════════════════════════════════════════════════╗
║                   MEV Bot Analytics Dashboard               ║
╚════════════════════════════════════════════════════════════╝
`);

// Overall statistics
const stats = database.getStats();
console.log(`📊 Overall Statistics:`);
console.log(`   Total swaps detected: ${stats.totalDetected}`);
console.log(`   Swaps confirmed on-chain: ${stats.confirmed}`);
console.log(`   Total PnL generated: ${stats.totalPnL?.toFixed(4) || "N/A"} MATIC`);
console.log(`   Average PnL per swap: ${stats.avgPnL?.toFixed(6) || "N/A"} MATIC`);
console.log();

// Backrun statistics
const backrunStats = database.getBackrunStats();
console.log(`🚀 Backrun Statistics:`);
console.log(`   Total attempts: ${backrunStats.totalAttempts}`);
console.log(`   Successful: ${backrunStats.successful} (${backrunStats.successRate}%)`);
console.log(`   Profitable: ${backrunStats.profitableCount}`);
console.log(`   Total profit: ${backrunStats.totalProfit?.toFixed(4) || "0"} MATIC`);
console.log(`   Average profit per backrun: ${(backrunStats.averageProfit || 0).toFixed(6)} MATIC`);
console.log();

// Top token pairs by volume
console.log(`🔝 Top Token Pairs (by count):`);
const topPairs = database.getTopTokenPairs(10);
topPairs.forEach((pair, idx) => {
  console.log(`   ${idx + 1}. ${pair.tokenA.slice(0, 6)}...${pair.tokenA.slice(-4)} ↔ ${pair.tokenB.slice(0, 6)}...${pair.tokenB.slice(-4)}: ${pair.count} swaps`);
});
console.log();

// Top DEXes by volume
console.log(`🔄 Volume by DEX:`);
const dexStats = database.getDexStats();
dexStats.forEach((dex) => {
  console.log(`   ${dex.dexName}: ${dex.count} swaps, avg impact ${dex.avgImpact?.toFixed(4) || "N/A"}%`);
});
console.log();

// Confirmed vs pending
console.log(`📈 Confirmation Status:`);
const unconfirmed = database.getUnconfirmedSwaps().length;
const confirmationRate =
  stats.totalDetected > 0 ? ((stats.confirmed / stats.totalDetected) * 100).toFixed(2) : "N/A";
console.log(`   Confirmed: ${stats.confirmed}/${stats.totalDetected} (${confirmationRate}%)`);
console.log(`   Pending: ${unconfirmed}`);
console.log();

// PnL distribution
console.log(`💰 PnL Distribution:`);
const pnlBuckets = database.getPnLDistribution();
console.log(`   Profitable (>0): ${pnlBuckets.profitable}`);
console.log(`   Break-even (0): ${pnlBuckets.breakeven}`);
console.log(`   Loss (<0): ${pnlBuckets.loss}`);
if (stats.totalPnL && stats.totalPnL > 0) {
  console.log(`   ✅ Win rate: ${((pnlBuckets.profitable / (pnlBuckets.profitable + pnlBuckets.loss)) * 100).toFixed(2)}%`);
}
console.log();

// Recent swaps
console.log(`🕐 Recent Swaps (last 5):`);
const recent = database.getRecentSwaps(5);
recent.forEach((swap) => {
  const status = swap.confirmedAt ? "✅" : "⏳";
  console.log(`   ${status} ${swap.txHash.slice(0, 10)}... | ${swap.dexName} | Impact: ${swap.predictedImpact?.toFixed(3)}% | PnL: ${swap.actualPnL || "pending"}`);
});

database.closeDatabase();
console.log(`\n✅ Analytics complete`);
