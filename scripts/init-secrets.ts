#!/usr/bin/env node
/**
 * Initialize Encrypted Secrets Manager
 * 
 * One-time script to migrate sensitive data from .env to encrypted storage
 * Run once: npx ts-node scripts/init-secrets.ts
 * 
 * After running:
 * 1. Secrets will be stored in encrypted .secrets.enc file
 * 2. Encryption key stored in .secrets.key (KEEP SAFE!)
 * 3. Remove sensitive values from .env
 * 4. Use only .env.example in your repository
 */

import "dotenv/config";
import {
  initializeSecretsFromEnv,
  getSecret,
  listSecretKeys,
  hasSecrets,
  storeSecret,
} from "./secrets-manager.ts";

const SENSITIVE_KEYS = [
  "PRIVATE_KEY",
  "TESTNET_PRIVATE_KEY",
  "ALCHEMY_API_KEY",
  "ALCHEMY_HTTP_URL",
  "ALCHEMY_WS_URL",
  "INFURA_API_KEY",
  "INFURA_HTTP_URL",
  "INFURA_WS_URL",
  "QUICKNODE_API_KEY",
  "QUICKNODE_HTTP_URL",
  "SLACK_WEBHOOK_URL",
  "DISCORD_WEBHOOK_URL",
];

async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║     MEV Bot - Encrypted Secrets Manager Initialization     ║
║                                                              ║
║  🔐 Migrating sensitive data from .env to encrypted storage ║
╚════════════════════════════════════════════════════════════╝
  `);

  // Check if secrets already exist
  if (hasSecrets()) {
    console.log("✅ Encrypted secrets file already exists (.secrets.enc)");
    const existing = listSecretKeys();
    console.log(`📦 Currently storing ${existing.length} secrets:\n`);
    existing.forEach((key) => {
      console.log(`   - ${key}`);
    });
    console.log(`\n❓ To update a secret, run:`);
    console.log(`   node update-secret.ts <KEY_NAME> <VALUE>\n`);
  }

  // Migrate from environment variables
  console.log("🔄 Checking for secrets in environment variables...\n");

  let migratedCount = 0;
  const missingSecrets: string[] = [];

  for (const key of SENSITIVE_KEYS) {
    const value = process.env[key];

    if (value) {
      // Check if already encrypted
      const existing = getSecret(key);
      if (existing) {
        console.log(`⏭️  ${key} - already encrypted (skipped)`);
      } else {
        storeSecret(key, value);
        migratedCount++;
        console.log(`✅ ${key} - migrated to encrypted storage`);
      }
    } else {
      // Only mark as missing if it's critical
      if (key === "PRIVATE_KEY" || key === "ALCHEMY_API_KEY") {
        missingSecrets.push(key);
      }
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   ✅ Migrated: ${migratedCount} secrets`);
  if (missingSecrets.length > 0) {
    console.log(`   ⚠️  Missing (critical): ${missingSecrets.join(", ")}`);
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log("🔐 Security Notes:");
  console.log(`   • Encryption key stored in: .secrets.key (ADD TO .gitignore)`);
  console.log(`   • Encrypted secrets stored in: .secrets.enc`);
  console.log(`   • File permissions: 0o600 (read/write owner only)`);
  console.log(`   • Keep .secrets.key in a safe location`);
  console.log(`\n📝 Next Steps:`);
  console.log(`   1. Keep .git ⚠️ Never commit .secrets.key or .secrets.enc`);
  console.log(`   2. Store .secrets.key safely (backup, KMS, etc)`);
  console.log(`   3. Update .env - remove sensitive values (use .env.example)`);
  console.log(`   4. Code will auto-load secrets securely on startup`);
  console.log(`\n✨ Your secrets are now encrypted and protected!`);
  console.log(`${"═".repeat(60)}\n`);
}

main().catch((error) => {
  console.error("❌ Initialization failed:", error);
  process.exit(1);
});
