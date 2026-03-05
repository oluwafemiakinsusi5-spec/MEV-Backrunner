import { ethers } from "ethers";

// ====== Configuration ======
interface RpcConfig {
  url: string;
  name: string;
  priority: number;
}

// RPC endpoints configuration
const HTTP_RPC_CONFIGS: RpcConfig[] = [
  { url: process.env.ALCHEMY_HTTP_URL || "", name: "Alchemy", priority: 1 },
  { url: process.env.INFURA_HTTP_URL || "", name: "Infura", priority: 2 },
  { url: process.env.QUICKNODE_HTTP_URL || "", name: "QuickNode", priority: 3 },
].filter(config => config.url && config.url.length > 0);

const WS_RPC_CONFIGS: RpcConfig[] = [
  { url: process.env.ALCHEMY_WS_URL || "", name: "Alchemy", priority: 1 },
  { url: process.env.INFURA_WS_URL || "", name: "Infura", priority: 2 },
].filter(config => config.url && config.url.length > 0);

// ====== State ======
let wsProvider: ethers.WebSocketProvider | null = null;
let httpProvider: ethers.JsonRpcProvider | null = null;
let currentHttpIndex = 0;
let currentWsIndex = 0;

// Health tracking
interface ProviderHealth {
  name: string;
  healthy: boolean;
  consecutiveFailures: number;
  lastSuccess: number;
  lastFailure: number;
}
const httpProvidersHealth: Map<string, ProviderHealth> = new Map();
const wsProvidersHealth: Map<string, ProviderHealth> = new Map();

// Constants
const MAX_CONSECUTIVE_FAILURES = 3;
const FAILURE_RESET_TIME = 5 * 60 * 1000; // 5 minutes

// ====== Initialization ======

function initializeHealthTracking(): void {
  for (const config of HTTP_RPC_CONFIGS) {
    httpProvidersHealth.set(config.url, {
      name: config.name,
      healthy: true,
      consecutiveFailures: 0,
      lastSuccess: Date.now(),
      lastFailure: 0,
    });
  }
  
  for (const config of WS_RPC_CONFIGS) {
    wsProvidersHealth.set(config.url, {
      name: config.name,
      healthy: true,
      consecutiveFailures: 0,
      lastSuccess: Date.now(),
      lastFailure: 0,
    });
  }
}

function getNextHealthyHttpProvider(): string | null {
  if (HTTP_RPC_CONFIGS.length === 0) return null;
  
  for (let i = 0; i < HTTP_RPC_CONFIGS.length; i++) {
    const index = (currentHttpIndex + i) % HTTP_RPC_CONFIGS.length;
    const config = HTTP_RPC_CONFIGS[index];
    const health = httpProvidersHealth.get(config.url);
    
    if (health && health.healthy) {
      currentHttpIndex = (index + 1) % HTTP_RPC_CONFIGS.length;
      return config.url;
    }
  }
  
  console.warn("⚠️ All HTTP providers marked unhealthy, using fallback");
  resetAllHttpHealth();
  return HTTP_RPC_CONFIGS[0]?.url || null;
}

function getNextHealthyWsProvider(): string | null {
  if (WS_RPC_CONFIGS.length === 0) return null;
  
  for (let i = 0; i < WS_RPC_CONFIGS.length; i++) {
    const index = (currentWsIndex + i) % WS_RPC_CONFIGS.length;
    const config = WS_RPC_CONFIGS[index];
    const health = wsProvidersHealth.get(config.url);
    
    if (health && health.healthy) {
      currentWsIndex = (index + 1) % WS_RPC_CONFIGS.length;
      return config.url;
    }
  }
  
  console.warn("⚠️ All WS providers marked unhealthy, using fallback");
  resetAllWsHealth();
  return WS_RPC_CONFIGS[0]?.url || null;
}

function resetAllHttpHealth(): void {
  for (const [url, health] of httpProvidersHealth) {
    health.healthy = true;
    health.consecutiveFailures = 0;
  }
}

function resetAllWsHealth(): void {
  for (const [url, health] of wsProvidersHealth) {
    health.healthy = true;
    health.consecutiveFailures = 0;
  }
}

function markHttpFailed(url: string): void {
  const health = httpProvidersHealth.get(url);
  if (!health) return;
  
  health.consecutiveFailures++;
  health.lastFailure = Date.now();
  
  if (health.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    health.healthy = false;
    console.warn(`❌ HTTP provider ${health.name} marked unhealthy (${health.consecutiveFailures} failures)`);
  }
}

function markHttpSuccess(url: string): void {
  const health = httpProvidersHealth.get(url);
  if (!health) return;
  
  health.consecutiveFailures = 0;
  health.lastSuccess = Date.now();
  health.healthy = true;
}

function markWsFailed(url: string): void {
  const health = wsProvidersHealth.get(url);
  if (!health) return;
  
  health.consecutiveFailures++;
  health.lastFailure = Date.now();
  
  if (health.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    health.healthy = false;
    console.warn(`❌ WS provider ${health.name} marked unhealthy (${health.consecutiveFailures} failures)`);
  }
}

function markWsSuccess(url: string): void {
  const health = wsProvidersHealth.get(url);
  if (!health) return;
  
  health.consecutiveFailures = 0;
  health.lastSuccess = Date.now();
  health.healthy = true;
}

// Periodic health check
setInterval(() => {
  const now = Date.now();
  
  for (const [url, health] of httpProvidersHealth) {
    if (!health.healthy && (now - health.lastFailure) > FAILURE_RESET_TIME) {
      health.healthy = true;
      health.consecutiveFailures = 0;
      console.log(`✅ HTTP provider ${health.name} marked healthy again`);
    }
  }
  
  for (const [url, health] of wsProvidersHealth) {
    if (!health.healthy && (now - health.lastFailure) > FAILURE_RESET_TIME) {
      health.healthy = true;
      health.consecutiveFailures = 0;
      console.log(`✅ WS provider ${health.name} marked healthy again`);
    }
  }
}, 60000);

initializeHealthTracking();

// ====== Public API ======

export function getHttpProvider(): ethers.JsonRpcProvider {
  if (!httpProvider) {
    const url = getNextHealthyHttpProvider();
    if (!url) {
      throw new Error("No HTTP providers available. Configure ALCHEMY_HTTP_URL, INFURA_HTTP_URL, or QUICKNODE_HTTP_URL");
    }
    
    httpProvider = new ethers.JsonRpcProvider(url);
    console.log(`🔗 Using HTTP provider: ${httpProvidersHealth.get(url)?.name || 'unknown'}`);
    
    httpProvider.on("error", (error: any) => {
      console.error(`❌ HTTP provider error: ${error.message || error}`);
      markHttpFailed(url);
      failoverHttpProvider();
    });
  }
  return httpProvider;
}

function failoverHttpProvider(): void {
  if (httpProvider) {
    httpProvider.removeAllListeners();
    httpProvider.destroy();
    httpProvider = null;
  }
  
  const newUrl = getNextHealthyHttpProvider();
  if (newUrl) {
    console.log(`🔄 Failing over to next HTTP provider...`);
    getHttpProvider();
  }
}

export function getWsProvider(): ethers.WebSocketProvider {
  if (!wsProvider) {
    const url = getNextHealthyWsProvider();
    if (!url) {
      throw new Error("No WS providers available. Configure ALCHEMY_WS_URL or INFURA_WS_URL");
    }
    
    wsProvider = new ethers.WebSocketProvider(url);
    console.log(`🔗 Using WS provider: ${wsProvidersHealth.get(url)?.name || 'unknown'}`);
    
    wsProvider.on("error", (error: any) => {
      console.error(`❌ WS provider error: ${error.message || error}`);
      markWsFailed(url);
    });
    
    wsProvider.on("close", (code: number) => {
      console.warn(`🔌 WS connection closed (code: ${code})`);
      markWsFailed(url);
      failoverWsProvider();
    });
  }
  return wsProvider;
}

function failoverWsProvider(): void {
  if (wsProvider) {
    wsProvider.removeAllListeners();
    wsProvider.destroy();
    wsProvider = null;
  }
  
  const newUrl = getNextHealthyWsProvider();
  if (newUrl) {
    console.log(`🔄 Failing over to next WS provider...`);
    getWsProvider();
  }
}

export function isConnected(): boolean {
  return wsProvider !== null || httpProvider !== null;
}

export async function getNetworkInfo(): Promise<{ chainId: bigint; name: string }> {
  const provider = getWsProvider();
  const network = await provider.getNetwork();
  return {
    chainId: network.chainId,
    name: network.name || "unknown"
  };
}

export function getProviderHealth(): { http: ProviderHealth[]; ws: ProviderHealth[] } {
  const http = Array.from(httpProvidersHealth.values());
  const ws = Array.from(wsProvidersHealth.values());
  return { http, ws };
}

export function forceHttpFailover(): void {
  failoverHttpProvider();
}

export function forceWsFailover(): void {
  failoverWsProvider();
}

// Legacy export for backwards compatibility
export function initializeProviderUrls(wsUrl: string, httpUrl: string): void {
  console.log("⚠️ initializeProviderUrls is deprecated - using auto-discovery");
}

export function cleanupProviders(): void {
  if (wsProvider) {
    wsProvider.removeAllListeners();
    wsProvider.destroy();
    wsProvider = null;
  }
  if (httpProvider) {
    httpProvider.removeAllListeners();
    httpProvider.destroy();
    httpProvider = null;
  }
  console.log("🧹 Providers cleaned up");
}
