/**
 * Secrets Manager
 * Handles encrypted storage and retrieval of sensitive data
 * Supports local encryption and can be extended for AWS Secrets Manager / HashiCorp Vault
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

// ====== Configuration ======
const ENCRYPTION_KEY_FILE = ".secrets.key";
const SECRETS_FILE = ".secrets.enc";
const KEY_ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

// ====== Types ======
export interface Secret {
  key: string;
  value: string;
  createdAt: number;
  updatedAt: number;
}

interface EncryptedData {
  iv: string;
  authTag: string;
  data: string;
}

// ====== Local Key Management ======

/**
 * Generate a new encryption key
 */
export function generateEncryptionKey(): Buffer {
  return randomBytes(KEY_LENGTH);
}

/**
 * Get or create encryption key
 */
function getEncryptionKey(): Buffer {
  const keyPath = resolve(ENCRYPTION_KEY_FILE);
  
  if (existsSync(keyPath)) {
    return readFileSync(keyPath);
  }
  
  // Generate new key
  const key = generateEncryptionKey();
  writeFileSync(keyPath, key, { mode: 0o600 });
  console.log("🔐 New encryption key generated. Keep .secrets.key safe!");
  return key;
}

// ====== Encryption ======

/**
 * Encrypt data
 */
function encrypt(plaintext: string): EncryptedData {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  
  const cipher = createCipheriv(KEY_ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  
  const authTag = cipher.getAuthTag();
  
  return {
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    data: encrypted
  };
}

/**
 * Decrypt data
 */
function decrypt(encryptedData: EncryptedData): string {
  const key = getEncryptionKey();
  const iv = Buffer.from(encryptedData.iv, "hex");
  const authTag = Buffer.from(encryptedData.authTag, "hex");
  
  const decipher = createDecipheriv(KEY_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedData.data, "hex", "utf8");
  decrypted += decipher.final("utf8");
  
  return decrypted;
}

// ====== Public API ======

/**
 * Store a secret
 */
export function storeSecret(key: string, value: string): void {
  const secretsPath = resolve(SECRETS_FILE);
  let secrets: Record<string, Secret> = {};
  
  // Load existing secrets
  if (existsSync(secretsPath)) {
    try {
      const encryptedData = JSON.parse(readFileSync(secretsPath, "utf8"));
      const decrypted = decrypt(encryptedData);
      secrets = JSON.parse(decrypted);
    } catch (error) {
      console.warn("⚠️ Could not decrypt existing secrets, starting fresh");
    }
  }
  
  // Update or add secret
  const now = Date.now();
  if (secrets[key]) {
    secrets[key].value = value;
    secrets[key].updatedAt = now;
  } else {
    secrets[key] = {
      key,
      value,
      createdAt: now,
      updatedAt: now
    };
  }
  
  // Encrypt and save
  const encrypted = encrypt(JSON.stringify(secrets));
  writeFileSync(secretsPath, JSON.stringify(encrypted), { mode: 0o600 });
  console.log(`✅ Secret '${key}' stored securely`);
}

/**
 * Retrieve a secret
 */
export function getSecret(key: string): string | null {
  const secretsPath = resolve(SECRETS_FILE);
  
  if (!existsSync(secretsPath)) {
    return null;
  }
  
  try {
    const encryptedData = JSON.parse(readFileSync(secretsPath, "utf8"));
    const decrypted = decrypt(encryptedData);
    const secrets: Record<string, Secret> = JSON.parse(decrypted);
    
    return secrets[key]?.value || null;
  } catch (error) {
    console.error("❌ Failed to retrieve secret:", error);
    return null;
  }
}

/**
 * Delete a secret
 */
export function deleteSecret(key: string): boolean {
  const secretsPath = resolve(SECRETS_FILE);
  
  if (!existsSync(secretsPath)) {
    return false;
  }
  
  try {
    const encryptedData = JSON.parse(readFileSync(secretsPath, "utf8"));
    const decrypted = decrypt(encryptedData);
    const secrets: Record<string, Secret> = JSON.parse(decrypted);
    
    if (!secrets[key]) {
      return false;
    }
    
    delete secrets[key];
    
    const encrypted = encrypt(JSON.stringify(secrets));
    writeFileSync(secretsPath, JSON.stringify(encrypted), { mode: 0o600 });
    console.log(`✅ Secret '${key}' deleted`);
    return true;
  } catch (error) {
    console.error("❌ Failed to delete secret:", error);
    return false;
  }
}

/**
 * List all secret keys (not values)
 */
export function listSecretKeys(): string[] {
  const secretsPath = resolve(SECRETS_FILE);
  
  if (!existsSync(secretsPath)) {
    return [];
  }
  
  try {
    const encryptedData = JSON.parse(readFileSync(secretsPath, "utf8"));
    const decrypted = decrypt(encryptedData);
    const secrets: Record<string, Secret> = JSON.parse(decrypted);
    
    return Object.keys(secrets);
  } catch (error) {
    return [];
  }
}

/**
 * Check if secrets file exists
 */
export function hasSecrets(): boolean {
  return existsSync(resolve(SECRETS_FILE));
}

/**
 * Initialize secrets with environment variables
 * Call this once to migrate .env secrets to encrypted storage
 */
export function initializeSecretsFromEnv(envVars: string[]): void {
  for (const varName of envVars) {
    const value = process.env[varName];
    if (value) {
      const existing = getSecret(varName);
      if (!existing) {
        storeSecret(varName, value);
        console.log(`📦 Migrated ${varName} to secrets manager`);
      }
    }
  }
}

// ====== AWS Secrets Manager Integration (Optional) ======

/**
 * Fetch secret from AWS Secrets Manager
 * Requires AWS credentials in environment
 */
export async function getSecretFromAWS(secretName: string): Promise<string | null> {
  // AWS SDK not installed - this is optional functionality
  console.warn("⚠️ AWS SDK not installed. Install with: npm install @aws-sdk/client-secrets-manager");
  return null;
}

/**
 * Store secret in AWS Secrets Manager
 */
export async function storeSecretInAWS(secretName: string, secretValue: string): Promise<boolean> {
  // AWS SDK not installed - this is optional functionality
  console.warn("⚠️ AWS SDK not installed. Install with: npm install @aws-sdk/client-secrets-manager");
  return false;
}

// ====== HashiCorp Vault Integration (Optional) ======

/**
 * Fetch secret from HashiCorp Vault
 */
export async function getSecretFromVault(path: string): Promise<string | null> {
  try {
    const token = process.env.VAULT_TOKEN;
    const addr = process.env.VAULT_ADDR || "http://localhost:8200";
    
    if (!token) {
      console.warn("⚠️ VAULT_TOKEN not set");
      return null;
    }
    
    const response = await fetch(`${addr}/v1/${path}`, {
      headers: {
        "X-Vault-Token": token
      }
    });
    
    if (!response.ok) {
      throw new Error(`Vault error: ${response.status}`);
    }
    
    const vaultData = await response.json();
    return (vaultData as any).data?.data || null;
  } catch (error) {
    console.error("❌ Vault error:", error);
    return null;
  }
}

/**
 * Store secret in HashiCorp Vault
 */
export async function storeSecretInVault(path: string, data: Record<string, string>): Promise<boolean> {
  try {
    const token = process.env.VAULT_TOKEN;
    const addr = process.env.VAULT_ADDR || "http://localhost:8200";
    
    if (!token) {
      console.warn("⚠️ VAULT_TOKEN not set");
      return false;
    }
    
    const response = await fetch(`${addr}/v1/${path}`, {
      method: "POST",
      headers: {
        "X-Vault-Token": token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ data })
    });
    
    if (!response.ok) {
      throw new Error(`Vault error: ${response.status}`);
    }
    
    console.log(`✅ Secret stored in Vault: ${path}`);
    return true;
  } catch (error) {
    console.error("❌ Vault error:", error);
    return false;
  }
}
