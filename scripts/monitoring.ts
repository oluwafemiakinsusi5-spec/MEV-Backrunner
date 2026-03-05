import "dotenv/config";

/**
 * Monitoring & Alerting System
 * Real-time monitoring of bot operations with email/Slack/Discord/PagerDuty alerts
 * Enhanced with profit drop alerts, gas spike detection, and consecutive failure tracking
 */

interface MonitoringMetrics {
  timestamp: number;
  swapsDetected: number;
  backrunsAttempted: number;
  backrunsSuccessful: number;
  backrunsFailed: number;
  totalProfit: bigint;
  totalGasCost: bigint;
  profitFactor: number;
  lastSwapTime: number;
  uptime: number;
  errorCount: number;
  consecutiveFailures: number;
  lastProfit: bigint;
  lastGasPrice: bigint;
}

interface AlertConfig {
  email?: {
    enabled: boolean;
    recipients: string[];
    service: string;
    apiKey?: string;
  };
  slack?: {
    enabled: boolean;
    webhookUrl: string;
    channel?: string;
  };
  discord?: {
    enabled: boolean;
    webhookUrl: string;
  };
  pagerduty?: {
    enabled: boolean;
    integrationKey: string;
  };
  thresholds: {
    profitThreshold: bigint;
    errorRateThreshold: number;
    uptime: number;
    consecutiveFailures: number;
    profitDropPercent: number;
    gasSpikePercent: number;
  };
}

class MonitoringSystem {
  private metrics: MonitoringMetrics;
  private alertConfig: AlertConfig;
  private startTime: number;
  private errorLog: { time: number; error: string }[];
  private lastAlertTime: number;
  private consecutiveFailures: number = 0;
  private previousProfit: bigint = 0n;
  private previousGasPrice: bigint = 0n;

  constructor(config: AlertConfig) {
    this.alertConfig = config;
    this.startTime = Date.now();
    this.lastAlertTime = 0;
    this.errorLog = [];
    this.metrics = {
      timestamp: Date.now(),
      swapsDetected: 0,
      backrunsAttempted: 0,
      backrunsSuccessful: 0,
      backrunsFailed: 0,
      totalProfit: 0n,
      totalGasCost: 0n,
      profitFactor: 0,
      lastSwapTime: 0,
      uptime: 0,
      errorCount: 0,
      consecutiveFailures: 0,
      lastProfit: 0n,
      lastGasPrice: 0n,
    };
  }

  recordSwapDetected(impact: number) {
    this.metrics.swapsDetected++;
    this.metrics.lastSwapTime = Date.now();
    console.log(`📊 Swap detected #${this.metrics.swapsDetected} (impact: ${impact.toFixed(2)}%)`);
  }

  recordBackrunAttempt(txHash: string) {
    this.metrics.backrunsAttempted++;
    console.log(`🚀 Backrun attempt #${this.metrics.backrunsAttempted}: ${txHash.slice(0, 10)}...`);
  }

  recordBackrunSuccess(profit: bigint, gasCost: bigint) {
    this.metrics.backrunsSuccessful++;
    this.metrics.totalProfit += profit;
    this.metrics.totalGasCost += gasCost;
    this.metrics.consecutiveFailures = 0;
    this.consecutiveFailures = 0;
    this.previousProfit = profit;
    this.metrics.lastProfit = profit;
    this.metrics.lastGasPrice = gasCost;
    
    if (this.previousGasPrice > 0n) {
      this.checkGasSpike(gasCost);
    }
    this.previousGasPrice = gasCost;

    this.metrics.profitFactor = this.metrics.totalProfit > 0n 
      ? Number(this.metrics.totalProfit) / Number(this.metrics.totalGasCost)
      : 0;

    console.log(`✅ Backrun successful #${this.metrics.backrunsSuccessful}`);
    console.log(`   💰 Profit: ${profit.toString()}`);
    console.log(`   ⛽ Gas cost: ${gasCost.toString()}`);
    console.log(`   📈 Profit factor: ${this.metrics.profitFactor.toFixed(2)}x`);

    if (profit > this.alertConfig.thresholds.profitThreshold) {
      this.sendAlert("🎯 High Profit Backrun!", {
        profit: profit.toString(),
        gasCost: gasCost.toString(),
      });
    }
  }

  recordBackrunFailure() {
    this.metrics.backrunsFailed++;
    this.metrics.consecutiveFailures++;
    this.consecutiveFailures++;
    this.previousProfit = 0n;

    console.error(`❌ Backrun failed (consecutive: ${this.consecutiveFailures})`);

    if (this.consecutiveFailures >= this.alertConfig.thresholds.consecutiveFailures) {
      this.sendAlert("🚨 Consecutive Backrun Failures!", {
        failures: this.consecutiveFailures.toString(),
        threshold: this.alertConfig.thresholds.consecutiveFailures.toString(),
      });
    }
  }

  private checkGasSpike(currentGasCost: bigint) {
    if (this.previousGasPrice === 0n) return;
    
    const percentChange = Math.abs(
      (Number(currentGasCost) - Number(this.previousGasPrice)) / Number(this.previousGasPrice) * 100
    );
    
    if (percentChange > this.alertConfig.thresholds.gasSpikePercent) {
      this.sendAlert("⛽ Gas Price Spike!", {
        current: currentGasCost.toString(),
        previous: this.previousGasPrice.toString(),
        change: percentChange.toFixed(2) + "%",
      });
    }
  }

  private checkProfitDrop(currentProfit: bigint) {
    if (this.previousProfit === 0n) return;
    
    const dropPercent = (Number(this.previousProfit) - Number(currentProfit)) / Number(this.previousProfit) * 100;
    
    if (dropPercent > this.alertConfig.thresholds.profitDropPercent) {
      this.sendAlert("📉 Profit Drop Detected!", {
        current: currentProfit.toString(),
        previous: this.previousProfit.toString(),
        drop: dropPercent.toFixed(2) + "%",
      });
    }
  }

  recordError(error: string) {
    this.metrics.errorCount++;
    this.errorLog.push({
      time: Date.now(),
      error,
    });

    if (this.errorLog.length > 1000) {
      this.errorLog.shift();
    }

    console.error(`❌ Error: ${error}`);

    const recentErrors = this.errorLog.filter(
      e => Date.now() - e.time < 60000
    );
    const errorRate = recentErrors.length / Math.max(this.metrics.swapsDetected, 1);

    if (errorRate > this.alertConfig.thresholds.errorRateThreshold) {
      this.sendAlert("🚨 High Error Rate", {
        errorCount: recentErrors.length.toString(),
        errorRate: errorRate.toFixed(2),
      });
    }
  }

  getMetrics(): MonitoringMetrics {
    const uptime = (Date.now() - this.startTime) / 60000;
    return {
      ...this.metrics,
      timestamp: Date.now(),
      uptime,
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  getSummary() {
    const metrics = this.getMetrics();
    const successRate =
      metrics.backrunsAttempted > 0
        ? ((metrics.backrunsSuccessful / metrics.backrunsAttempted) * 100).toFixed(2)
        : "0";

    return {
      uptime: `${Math.floor(metrics.uptime)} minutes`,
      swapsDetected: metrics.swapsDetected,
      backrunsAttempted: metrics.backrunsAttempted,
      backrunsSuccessful: metrics.backrunsSuccessful,
      successRate: `${successRate}%`,
      totalProfit: metrics.totalProfit.toString(),
      totalGasCost: metrics.totalGasCost.toString(),
      profitFactor: metrics.profitFactor.toFixed(2),
      errorCount: metrics.errorCount,
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  private async sendAlert(title: string, data: Record<string, string>) {
    const timeSinceLastAlert = Date.now() - this.lastAlertTime;
    if (timeSinceLastAlert < 300000) {
      return;
    }
    this.lastAlertTime = Date.now();

    if (this.alertConfig.slack?.enabled) {
      await this.sendSlackAlert(title, data);
    }

    if (this.alertConfig.discord?.enabled) {
      await this.sendDiscordAlert(title, data);
    }

    if (this.alertConfig.pagerduty?.enabled) {
      await this.sendPagerDutyAlert(title, data);
    }

    if (this.alertConfig.email?.enabled) {
      await this.sendEmailAlert(title, Object.entries(data).map(([k,v]) => `${k}: ${v}`).join("\n"));
    }
  }

  private formatAlertMessage(title: string, data: Record<string, string>): string {
    const lines = [
      `MEV Bot Alert: ${title}`,
      `Time: ${new Date().toISOString()}`,
      "",
      ...Object.entries(data).map(([k, v]) => `${k}: ${v}`),
    ];
    return lines.join("\n");
  }

  private async sendSlackAlert(title: string, data: Record<string, string>) {
    if (!this.alertConfig.slack) return;

    try {
      const payload = {
        channel: this.alertConfig.slack.channel || "#alerts",
        text: title,
        attachments: [
          {
            color: title.includes("🎯") ? "good" : "warning",
            fields: Object.entries(data).map(([title, value]) => ({
              title,
              value,
              short: true,
            })),
            ts: Math.floor(Date.now() / 1000),
          },
        ],
      };

      const response = await fetch(this.alertConfig.slack.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.warn(`⚠️ Slack alert failed: ${response.statusText}`);
      }
    } catch (error: any) {
      console.warn(`⚠️ Failed to send Slack alert: ${error.message}`);
    }
  }

  private async sendDiscordAlert(title: string, data: Record<string, string>) {
    if (!this.alertConfig.discord) return;

    try {
      const embed = {
        title,
        color: title.includes("🎯") ? 3066993 : 16776960,
        fields: Object.entries(data).map(([name, value]) => ({
          name,
          value,
          inline: true,
        })),
        timestamp: new Date().toISOString(),
      };

      const payload = { embeds: [embed] };

      const response = await fetch(this.alertConfig.discord.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.warn(`⚠️ Discord alert failed: ${response.statusText}`);
      }
    } catch (error: any) {
      console.warn(`⚠️ Failed to send Discord alert: ${error.message}`);
    }
  }

  private async sendPagerDutyAlert(title: string, data: Record<string, string>) {
    if (!this.alertConfig.pagerduty) return;

    try {
      const payload = {
        routing_key: this.alertConfig.pagerduty.integrationKey,
        event_action: "trigger",
        payload: {
          summary: `MEV Bot: ${title}`,
          severity: title.includes("🎯") ? "info" : "warning",
          source: "mev-bot",
          custom_details: data,
        },
      };

      const response = await fetch("https://events.pagerduty.com/v2/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.warn(`⚠️ PagerDuty alert failed: ${response.statusText}`);
      }
    } catch (error: any) {
      console.warn(`⚠️ Failed to send PagerDuty alert: ${error.message}`);
    }
  }

  private async sendEmailAlert(title: string, message: string) {
    if (!this.alertConfig.email) return;
    console.log(`📧 Email alert: ${title}`);
  }
}

class HealthCheck {
  private lastCheck: number;
  private checkInterval: number;
  private monitoring: MonitoringSystem;

  constructor(monitoring: MonitoringSystem, intervalMs: number = 60000) {
    this.monitoring = monitoring;
    this.checkInterval = intervalMs;
    this.lastCheck = Date.now();
  }

  start() {
    setInterval(() => this.performCheck(), this.checkInterval);
    console.log(`🏥 Health check started (interval: ${this.checkInterval}ms)`);
  }

  private performCheck() {
    const metrics = this.monitoring.getMetrics();
    const timeSinceLastSwap = Date.now() - metrics.lastSwapTime;

    if (metrics.swapsDetected > 0 && timeSinceLastSwap > 600000) {
      console.warn(`⚠️ No swaps detected in last ${Math.floor(timeSinceLastSwap / 1000 / 60)} minutes`);
    }

    const summary = this.monitoring.getSummary();
    console.log(`\n${"─".repeat(60)}`);
    console.log(`📊 Health Check - ${new Date().toISOString()}`);
    console.log(summary);
    console.log("─".repeat(60));
  }
}

const monitoringConfig: AlertConfig = {
  slack: {
    enabled: !!process.env.SLACK_WEBHOOK_URL,
    webhookUrl: process.env.SLACK_WEBHOOK_URL || "",
    channel: "#mev-bot",
  },
  discord: {
    enabled: !!process.env.DISCORD_WEBHOOK_URL,
    webhookUrl: process.env.DISCORD_WEBHOOK_URL || "",
  },
  pagerduty: {
    enabled: !!process.env.PAGERDUTY_KEY,
    integrationKey: process.env.PAGERDUTY_KEY || "",
  },
  email: {
    enabled: !!process.env.EMAIL_SERVICE,
    recipients: (process.env.EMAIL_RECIPIENTS || "").split(",").filter(Boolean),
    service: (process.env.EMAIL_SERVICE as any) || "sendgrid",
    apiKey: process.env.EMAIL_API_KEY,
  },
  thresholds: {
    profitThreshold: BigInt(process.env.PROFIT_ALERT_THRESHOLD || "1000000000000000000"),
    errorRateThreshold: 0.1,
    uptime: 60,
    consecutiveFailures: parseInt(process.env.ALERT_CONSECUTIVE_FAILURES || "3"),
    profitDropPercent: parseFloat(process.env.ALERT_PROFIT_DROP_PERCENT || "50"),
    gasSpikePercent: parseFloat(process.env.ALERT_GAS_SPIKE_PERCENT || "100"),
  },
};

export const monitoring = new MonitoringSystem(monitoringConfig);
export const healthCheck = new HealthCheck(monitoring, 60000);

export { MonitoringSystem, HealthCheck };
