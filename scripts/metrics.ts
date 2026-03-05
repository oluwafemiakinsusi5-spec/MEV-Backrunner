/**
 * Metrics Export for Prometheus/Grafana
 * Tracks MEV bot performance metrics
 */

import { ethers } from "ethers";

// ====== Metrics Storage ======
interface MetricPoint {
  value: number;
  timestamp: number;
}

interface BotMetrics {
  // Backrun metrics
  backrunsTotal: number;
  backrunsSuccess: number;
  backrunsFailed: number;
  totalProfit: bigint;
  totalGasSpent: bigint;
  
  // Timing metrics
  lastBackrunTime: number;
  lastSuccessTime: number;
  lastFailureTime: number;
  
  // Competitor metrics
  competitorsDetected: number;
  opportunitiesSkipped: number;
  
  // Price metrics
  averageProfitPerBackrun: number;
  averageGasPrice: bigint;
  
  // Time series data (last 24 hours)
  profitHistory: MetricPoint[];
  volumeHistory: MetricPoint[];
}

const metrics: BotMetrics = {
  backrunsTotal: 0,
  backrunsSuccess: 0,
  backrunsFailed: 0,
  totalProfit: 0n,
  totalGasSpent: 0n,
  lastBackrunTime: 0,
  lastSuccessTime: 0,
  lastFailureTime: 0,
  competitorsDetected: 0,
  opportunitiesSkipped: 0,
  averageProfitPerBackrun: 0,
  averageGasPrice: 0n,
  profitHistory: [],
  volumeHistory: []
};

// Constants
const HISTORY_DURATION = 24 * 60 * 60 * 1000; // 24 hours in ms
const HISTORY_INTERVAL = 60 * 1000; // 1 minute intervals

// ====== Metric Functions ======

/**
 * Record a backrun attempt
 */
export function recordBackrunAttempt(): void {
  metrics.backrunsTotal++;
  metrics.lastBackrunTime = Date.now();
}

/**
 * Record a successful backrun
 */
export function recordBackrunSuccess(profit: bigint, gasSpent: bigint): void {
  metrics.backrunsSuccess++;
  metrics.totalProfit += profit;
  metrics.totalGasSpent += gasSpent;
  metrics.lastSuccessTime = Date.now();
  
  // Calculate average
  metrics.averageProfitPerBackrun = Number(metrics.totalProfit) / metrics.backrunsSuccess;
  
  // Add to history
  addToHistory(metrics.profitHistory, Number(profit));
}

/**
 * Record a failed backrun
 */
export function recordBackrunFailure(): void {
  metrics.backrunsFailed++;
  metrics.lastFailureTime = Date.now();
}

/**
 * Record competitor detection
 */
export function recordCompetitor(count: number): void {
  metrics.competitorsDetected += count;
}

/**
 * Record skipped opportunity
 */
export function recordOpportunitySkipped(): void {
  metrics.opportunitiesSkipped++;
}

/**
 * Record gas price
 */
export function recordGasPrice(gasPrice: bigint): void {
  // Simple moving average
  if (metrics.averageGasPrice === 0n) {
    metrics.averageGasPrice = gasPrice;
  } else {
    metrics.averageGasPrice = (metrics.averageGasPrice * 7n + gasPrice) / 8n;
  }
}

/**
 * Add point to time series history
 */
function addToHistory(history: MetricPoint[], value: number): void {
  const now = Date.now();
  
  // Aggregate into current interval if recent
  if (history.length > 0) {
    const last = history[history.length - 1];
    if (now - last.timestamp < HISTORY_INTERVAL) {
      last.value += value;
      return;
    }
  }
  
  history.push({ value, timestamp: now });
  
  // Prune old data
  const cutoff = now - HISTORY_DURATION;
  while (history.length > 0 && history[0].timestamp < cutoff) {
    history.shift();
  }
}

/**
 * Record volume (for charts)
 */
export function recordVolume(amount: bigint): void {
  addToHistory(metrics.volumeHistory, Number(amount));
}

// ====== Prometheus Format Export ======

/**
 * Generate Prometheus metrics text format
 */
export function generatePrometheusMetrics(): string {
  const lines: string[] = [
    "# HELP mev_bot_backruns_total Total number of backrun attempts",
    "# TYPE mev_bot_backruns_total counter",
    `mev_bot_backruns_total ${metrics.backrunsTotal}`,
    "",
    "# HELP mev_bot_backruns_success Total successful backruns",
    "# TYPE mev_bot_backruns_success counter",
    `mev_bot_backruns_success ${metrics.backrunsSuccess}`,
    "",
    "# HELP mev_bot_backruns_failed Total failed backruns",
    "# TYPE mev_bot_backruns_failed counter",
    `mev_bot_backruns_failed ${metrics.backrunsFailed}`,
    "",
    "# HELP mev_bot_total_profit Total profit in wei",
    "# TYPE mev_bot_total_profit gauge",
    `mev_bot_total_profit ${metrics.totalProfit}`,
    "",
    "# HELP mev_bot_total_gas_spent Total gas spent in wei",
    "# TYPE mev_bot_total_gas_spent gauge",
    `mev_bot_total_gas_spent ${metrics.totalGasSpent}`,
    "",
    "# HELP mev_bot_success_rate Success rate as percentage",
    "# TYPE mev_bot_success_rate gauge",
    `mev_bot_success_rate ${metrics.backrunsTotal > 0 ? (metrics.backrunsSuccess / metrics.backrunsTotal * 100).toFixed(2) : 0}`,
    "",
    "# HELP mev_bot_average_profit Average profit per backrun",
    "# TYPE mev_bot_average_profit gauge",
    `mev_bot_average_profit ${metrics.averageProfitPerBackrun}`,
    "",
    "# HELP mev_bot_competitors_detected Total competitors detected",
    "# TYPE mev_bot_competitors_detected counter",
    `mev_bot_competitors_detected ${metrics.competitorsDetected}`,
    "",
    "# HELP mev_bot_opportunities_skipped Opportunities skipped due to competition",
    "# TYPE mev_bot_opportunities_skipped counter",
    `mev_bot_opportunities_skipped ${metrics.opportunitiesSkipped}`,
    "",
    "# HELP mev_bot_average_gas_price Average gas price in wei",
    "# TYPE mev_bot_average_gas_price gauge",
    `mev_bot_average_gas_price ${metrics.averageGasPrice}`,
    "",
    "# HELP mev_bot_last_backrun_timestamp Unix timestamp of last backrun",
    "# TYPE mev_bot_last_backrun_timestamp gauge",
    `mev_bot_last_backrun_timestamp ${metrics.lastBackrunTime}`,
    "",
    "# HELP mev_bot_uptime_seconds Seconds since first backrun",
    "# TYPE mev_bot_uptime_seconds gauge",
    `mev_bot_uptime_seconds ${metrics.lastBackrunTime > 0 ? Math.floor((Date.now() - metrics.lastBackrunTime) / 1000) : 0}`,
  ];
  
  return lines.join("\n");
}

/**
 * Get metrics as JSON (for programmatic access)
 */
export function getMetricsJSON(): object {
  return {
    backrunsTotal: metrics.backrunsTotal,
    backrunsSuccess: metrics.backrunsSuccess,
    backrunsFailed: metrics.backrunsFailed,
    successRate: metrics.backrunsTotal > 0 
      ? (metrics.backrunsSuccess / metrics.backrunsTotal * 100).toFixed(2) + "%"
      : "0%",
    totalProfit: metrics.totalProfit.toString(),
    totalGasSpent: metrics.totalGasSpent.toString(),
    averageProfitPerBackrun: metrics.averageProfitPerBackrun,
    averageGasPrice: metrics.averageGasPrice.toString(),
    competitorsDetected: metrics.competitorsDetected,
    opportunitiesSkipped: metrics.opportunitiesSkipped,
    lastBackrunTime: new Date(metrics.lastBackrunTime).toISOString(),
    lastSuccessTime: metrics.lastSuccessTime > 0 
      ? new Date(metrics.lastSuccessTime).toISOString() 
      : null,
    lastFailureTime: metrics.lastFailureTime > 0 
      ? new Date(metrics.lastFailureTime).toISOString() 
      : null,
    profitHistory: metrics.profitHistory.map(p => ({
      value: p.value,
      timestamp: new Date(p.timestamp).toISOString()
    })),
    volumeHistory: metrics.volumeHistory.map(v => ({
      value: v.value,
      timestamp: new Date(v.timestamp).toISOString()
    }))
  };
}

/**
 * Get current metrics object
 */
export function getMetrics(): BotMetrics {
  return { ...metrics };
}

/**
 * Reset all metrics
 */
export function resetMetrics(): void {
  metrics.backrunsTotal = 0;
  metrics.backrunsSuccess = 0;
  metrics.backrunsFailed = 0;
  metrics.totalProfit = 0n;
  metrics.totalGasSpent = 0n;
  metrics.lastBackrunTime = 0;
  metrics.lastSuccessTime = 0;
  metrics.lastFailureTime = 0;
  metrics.competitorsDetected = 0;
  metrics.opportunitiesSkipped = 0;
  metrics.averageProfitPerBackrun = 0;
  metrics.averageGasPrice = 0n;
  metrics.profitHistory = [];
  metrics.volumeHistory = [];
  console.log("📊 Metrics reset");
}

// ====== HTTP Server for Prometheus Scraping ======
import { createServer, IncomingMessage, ServerResponse } from "http";

let metricsServer: ReturnType<typeof createServer> | null = null;

/**
 * Start HTTP server for Prometheus metrics
 */
export function startMetricsServer(port: number = 9090): void {
  if (metricsServer) {
    console.log("⚠️ Metrics server already running");
    return;
  }
  
  metricsServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/metrics") {
      res.writeHead(200, { 
        "Content-Type": "text/plain; version=0.0.4",
        "Access-Control-Allow-Origin": "*"
      });
      res.end(generatePrometheusMetrics());
    } else if (req.url === "/metrics.json") {
      res.writeHead(200, { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      });
      res.end(JSON.stringify(getMetricsJSON(), null, 2));
    } else if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", timestamp: Date.now() }));
    } else if (req.url === "/reset") {
      resetMetrics();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "reset" }));
    } else {
      res.writeHead(404);
      res.end("Not Found");
    }
  });
  
  metricsServer.listen(port, () => {
    console.log(`📊 Metrics server running on http://localhost:${port}`);
    console.log(`   - Prometheus metrics: /metrics`);
    console.log(`   - JSON metrics: /metrics.json`);
    console.log(`   - Health check: /health`);
    console.log(`   - Reset metrics: /reset`);
  });
}

/**
 * Stop metrics server
 */
export function stopMetricsServer(): void {
  if (metricsServer) {
    metricsServer.close();
    metricsServer = null;
    console.log("📊 Metrics server stopped");
  }
}
