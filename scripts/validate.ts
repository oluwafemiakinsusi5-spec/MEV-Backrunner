import "dotenv/config";
import { initializeProviderUrls } from "./provider.ts";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface Config {
  wsUrl: string;
  httpUrl: string;
  backrunEnabled: boolean;
  backrunImpactThreshold: number;
  seenTxTtlMs: number;
  minCalldataBytes: number;
  minAmountIn: bigint;
  privateKey?: string;
}

/**
 * Validate all environment variables and return configuration
 */
export function validateConfig(): Config {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ALCHEMY_WS_URL - Required
  const wsUrl = process.env.ALCHEMY_WS_URL || "";
  if (!wsUrl) {
    errors.push("ALCHEMY_WS_URL is required (e.g., wss://polygon-mainnet.g.alchemy.com/v2/...)");
  } else if (!wsUrl.startsWith("wss://")) {
    errors.push("ALCHEMY_WS_URL must be a WebSocket URL (wss://...)");
  }

  // ALCHEMY_HTTP_URL - Optional but validated if provided
  const httpUrl = process.env.ALCHEMY_HTTP_URL || (wsUrl ? wsUrl.replace(/^wss:/, "https:") : "");

  // BACKRUN_ENABLED
  let backrunEnabled = false;
  if (process.env.BACKRUN_ENABLED) {
    if (process.env.BACKRUN_ENABLED === "1" || process.env.BACKRUN_ENABLED === "true") {
      backrunEnabled = true;
    } else if (process.env.BACKRUN_ENABLED !== "0" && process.env.BACKRUN_ENABLED !== "false") {
      warnings.push("BACKRUN_ENABLED should be '1', 'true', '0', or 'false' - treating as disabled");
    }
  }

  // BACKRUN_IMPACT_THRESHOLD
  let backrunImpactThreshold = 0;
  if (process.env.BACKRUN_IMPACT_THRESHOLD) {
    const parsed = parseFloat(process.env.BACKRUN_IMPACT_THRESHOLD);
    if (isNaN(parsed)) {
      errors.push("BACKRUN_IMPACT_THRESHOLD must be a valid number");
    } else if (parsed < 0 || parsed > 100) {
      errors.push("BACKRUN_IMPACT_THRESHOLD must be between 0 and 100");
    } else {
      backrunImpactThreshold = parsed;
    }
  }

  // SEEN_TX_TTL_MS
  let seenTxTtlMs = 5 * 60 * 1000; // 5 minutes default
  if (process.env.SEEN_TX_TTL_MS) {
    const parsed = parseInt(process.env.SEEN_TX_TTL_MS);
    if (isNaN(parsed) || parsed <= 0) {
      errors.push("SEEN_TX_TTL_MS must be a positive integer (milliseconds)");
    } else {
      seenTxTtlMs = parsed;
    }
  }

  // MIN_CALLDATA_BYTES
  let minCalldataBytes = 0;
  if (process.env.MIN_CALLDATA_BYTES) {
    const parsed = parseInt(process.env.MIN_CALLDATA_BYTES);
    if (isNaN(parsed) || parsed < 0) {
      errors.push("MIN_CALLDATA_BYTES must be a non-negative integer");
    } else {
      minCalldataBytes = parsed;
    }
  }

  // MIN_AMOUNTIN
  let minAmountIn = BigInt(0);
  if (process.env.MIN_AMOUNTIN) {
    try {
      minAmountIn = BigInt(process.env.MIN_AMOUNTIN);
      if (minAmountIn < 0n) {
        errors.push("MIN_AMOUNTIN must be a non-negative integer");
        minAmountIn = BigInt(0);
      }
    } catch {
      errors.push("MIN_AMOUNTIN must be a valid integer");
    }
  }

  // PRIVATE_KEY - Warning only (backrun won't work without it)
  let privateKey: string | undefined;
  if (backrunEnabled) {
    if (!process.env.PRIVATE_KEY) {
      warnings.push("BACKRUN_ENABLED is true but PRIVATE_KEY not set - backrun will be disabled");
    } else {
      privateKey = process.env.PRIVATE_KEY;
      // Basic validation - should be 64 hex characters (without 0x) or 66 (with 0x)
      const key = privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey;
      if (!/^[0-9a-fA-F]{64}$/.test(key)) {
        errors.push("PRIVATE_KEY appears to be invalid (should be 64 hex characters)");
      }
    }
  }

  const result: ValidationResult = {
    valid: errors.length === 0,
    errors,
    warnings,
  };

  // Print validation results
  if (!result.valid) {
    console.error("🛑 Configuration Validation Failed:");
    errors.forEach((e) => console.error(`   ❌ ${e}`));
  }

  if (warnings.length > 0) {
    console.warn("⚠️  Configuration Warnings:");
    warnings.forEach((w) => console.warn(`   ⚠️  ${w}`));
  }

  if (!result.valid) {
    throw new Error("Invalid configuration - see errors above");
  }

  // Initialize provider URLs for lazy provider creation
  initializeProviderUrls(wsUrl, httpUrl);

  console.log("✅ Configuration validated successfully");

  if (warnings.length > 0) {
    console.log("   (with " + warnings.length + " warning(s))");
  }

  return {
    wsUrl,
    httpUrl,
    backrunEnabled,
    backrunImpactThreshold,
    seenTxTtlMs,
    minCalldataBytes,
    minAmountIn,
    privateKey,
  };
}
