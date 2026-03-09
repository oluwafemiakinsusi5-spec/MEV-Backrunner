/**
 * Secure Secrets Loader
 * 
 * Central interface for loading sensitive data from encrypted storage
 * Minimizes private key exposure in memory and logs
 */

import "dotenv/config";
import { getSecret, storeSecret } from "./secrets-manager.ts";

// Cache secrets in memory (only during runtime)
const secretsCache = new Map<string, string>();

/**
 * Load a secret - tries encrypted storage first, then environment
 * @param key - Secret key name
 * @param fallbackToEnv - If true, falls back to process.env if encryption not available
 * @returns Secret value or null if not found
 */
export function loadSecret(
  key: string,
  fallbackToEnv: boolean = true
): string | null {
  // Check cache first
  if (secretsCache.has(key)) {
    return secretsCache.get(key)!;
  }

  // Try encrypted storage
  const encrypted = getSecret(key);
  if (encrypted) {
    secretsCache.set(key, encrypted);
    return encrypted;
  }

  // Fallback to environment (if enabled)
  if (fallbackToEnv) {
    const envValue = process.env[key];
    if (envValue) {
      // Auto-store in encrypted storage for next time
      try {
        storeSecret(key, envValue);
      } catch {
        // Silently fail - still usable from env
      }
      secretsCache.set(key, envValue);
      return envValue;
    }
  }

  return null;
}

/**
 * Safely create a wallet from a secret key
 * Minimal exposure - only the required key is decrypted
 */
export async function loadWalletSecret(keyName: string = "PRIVATE_KEY") {
  const { Wallet } = await import("ethers");
  
  const privateKey = loadSecret(keyName);
  if (!privateKey) {
    throw new Error(`Private key not found: ${keyName}`);
  }

  return new Wallet(privateKey);
}

/**
 * Load multiple secrets at once (minimizes multiple decryption cycles)
 */
export function loadSecrets(keys: string[]): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  for (const key of keys) {
    result[key] = loadSecret(key);
  }
  return result;
}

/**
 * Clear secrets cache (call before exit for safety)
 */
export function clearSecretsCache(): void {
  secretsCache.clear();
}

/**
 * Update a secret and cache it
 */
export function updateAndCacheSecret(key: string, value: string): void {
  storeSecret(key, value);
  secretsCache.set(key, value);
}

/**
 * Check if a secret exists (in encrypted storage)
 */
export function hasSecret(key: string): boolean {
  return getSecret(key) !== null || process.env[key] !== undefined;
}
