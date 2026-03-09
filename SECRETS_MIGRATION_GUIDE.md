# 🔐 Encrypted Secrets System - Implementation Guide

## Overview

This MEV bot now uses an **encrypted secrets management system** to protect your private keys and sensitive credentials. All keys are encrypted locally using AES-256-GCM and never exposed in plain text during runtime.

## What Changed

### ✅ Before (Vulnerable)
```bash
# .env file (committed to git - DANGEROUS!)
PRIVATE_KEY=366d5287e3b353091ef94589c8adebe3934b56513d9952c0b9eb25fcab69cdd1
ALCHEMY_API_KEY=HbG2B-oRSDCgwuEsEkISd
```

**Problems:**
- Private keys in plain text in `.env`
- Once committed to git, exposed forever
- Visible in logs and error messages
- File permissions not secure

### ✅ After (Secure)
```bash
# .env file (safe to commit)
PRIVATE_KEY=                    # Empty - loaded from encrypted storage
ALCHEMY_API_KEY=               # Empty - loaded from encrypted storage

# Encrypted storage files (NEVER commit)
.secrets.enc    # Encrypted secrets (safe to backup)
.secrets.key    # Encryption key (KEEP EXTREMELY SECURE)
```

**Benefits:**
- Keys encrypted with AES-256-GCM
- Encryption key stored separately
- No exposure in logs or errors
- Automatic migration from .env to encrypted storage
- Backward compatible with environment variables

## Quick Start (5 minutes)

### 1. Initialize Encrypted Storage

```bash
npx ts-node scripts/init-secrets.ts
```

This will:
- Generate an encryption key (`.secrets.key`)
- Migrate secrets from `.env` to encrypted storage (`.secrets.enc`)
- Set proper file permissions (0o600)
- Display migration summary

**Output:**
```
╔════════════════════════════════════════════════════════════╗
║     MEV Bot - Encrypted Secrets Manager Initialization     ║
╚════════════════════════════════════════════════════════════╝

🔄 Checking for secrets in environment variables...

✅ PRIVATE_KEY - migrated to encrypted storage
✅ ALCHEMY_API_KEY - migrated to encrypted storage
...

📊 Summary:
   ✅ Migrated: 8 secrets
   
🔐 Security Notes:
   • Encryption key stored in: .secrets.key
   • Encrypted secrets stored in: .secrets.enc
   • Keep .secrets.key in a safe location
```

### 2. Backup Your Encryption Key

```bash
# Create secure backup
cp .secrets.key ~/.mev-bot-backup.key
chmod 400 ~/.mev-bot-backup.key

# Or use AWS Secrets Manager
aws secretsmanager create-secret --name mev-bot-encryption-key \
  --secret-string $(cat .secrets.key)
```

**⚠️ CRITICAL:** If you lose `.secrets.key`, you cannot recover your secrets!

### 3. Clean Up `.env`

Remove sensitive values from `.env`:

```diff
- PRIVATE_KEY=366d5287e3b353091ef94589c8adebe3934b56513d9952c0b9eb25fcab69cdd1
+ PRIVATE_KEY=

- ALCHEMY_API_KEY=HbG2B-oRSDCgwuEsEkISd
+ ALCHEMY_API_KEY=
```

Or copy from template:
```bash
cp .env.example .env
# Edit .env to add your RPC URLs (non-sensitive values)
```

### 4. Verify Security

```bash
# Check .gitignore includes secrets
cat .gitignore | grep -E "\.secrets\.(enc|key)"

# Verify file permissions
ls -la .secrets.key          # Should be -rw------- (0o600)
ls -la .secrets.enc          # Should be -rw------- (0o600)
```

### 5. Run Your Bot

```bash
# Secrets are automatically loaded from encrypted storage
npx ts-node scripts/mempool-listener.ts
```

**New output:**
```
🔐 Loaded PRIVATE_KEY from encrypted storage
🔐 Loaded ALCHEMY_API_KEY from encrypted storage
✅ Backrun wallet initialized: 0x...
```

## Architecture

### Files Modified

| File | Change |
|------|--------|
| `scripts/secrets-loader.ts` | **NEW** - Central secrets loading interface |
| `scripts/init-secrets.ts` | **NEW** - One-time migration script |
| `scripts/private-transactions.ts` | Updated to load keys from encrypted storage |
| `scripts/mempool-listener.ts` | Updated to load wallet from encrypted storage |
| `scripts/deploy-backrun.ts` | Updated to load private key from encrypted storage |
| `scripts/testnet-validator.ts` | Updated to load testnet key from encrypted storage |
| `hardhat.config.ts` | Updated to load all private keys from encrypted storage |
| `.gitignore` | Added `.secrets.enc` and `.secrets.key` |

### Encryption Approach

```
Plaintext Secret
       ↓
AES-256-GCM Encryption
  (with random IV)
       ↓
Encrypted Data
  (stored in .secrets.enc)
       ↓
Encryption Key
  (stored in .secrets.key)
```

**Algorithm Details:**
- **Mode:** AES-256-GCM (Galois/Counter Mode)
- **Key Length:** 256 bits (32 bytes)
- **IV Length:** 128 bits (16 bytes) - random for each encryption
- **Auth Tag Length:** 128 bits (16 bytes) - prevents tampering
- **File Permissions:** 0o600 (read/write owner only)

## Usage in Code

### Loading Secrets in Your Code

```typescript
import { loadSecret, hasSecret } from "./scripts/secrets-loader.ts";

// Load a single secret
const privateKey = loadSecret("PRIVATE_KEY");

// Check if secret exists
if (hasSecret("PRIVATE_KEY")) {
  console.log("✅ Private key configured");
}

// Load multiple secrets at once (minimizes decryption cycles)
const secrets = loadSecrets(["PRIVATE_KEY", "ALCHEMY_API_KEY"]);

// Load with fallback to environment
const key = loadSecret("PRIVATE_KEY", true);  // true = fallback to env
```

### Creating a Wallet Securely

```typescript
import { loadWalletSecret } from "./scripts/secrets-loader.ts";
import { ethers } from "ethers";

// Minimal exposure - only decrypts the key when needed
const wallet = await loadWalletSecret("PRIVATE_KEY");
console.log(`✅ Wallet loaded: ${wallet.address}`);
```

### Private Transaction Manager

```typescript
import { PrivateTransactionManager } from "./scripts/private-transactions.ts";

// Constructor automatically loads private key from encrypted storage
const manager = new PrivateTransactionManager();  // No key parameter needed
```

## Security Best Practices

### ✅ DO

- ✅ Run `init-secrets.ts` to migrate keys
- ✅ Backup `.secrets.key` securely (AWS KMS, HashiCorp Vault, etc.)
- ✅ Add `.secrets.key` to `.gitignore`
- ✅ Use `loadSecret()` to retrieve keys
- ✅ Rotate encryption key when keys are compromised
- ✅ Store `.secrets.key` on secure infrastructure

### ❌ DON'T

- ❌ Commit `.secrets.key` to git
- ❌ Commit `.secrets.enc` with old unencrypted keys
- ❌ Share `.secrets.key` unencrypted
- ❌ Store `.secrets.key` in environment variables
- ❌ Print secrets to logs
- ❌ Pass private keys as function parameters (use `loadSecret()` instead)

## Deployment on EC2

### Option 1: AWS Secrets Manager (Recommended)

```bash
# On local machine - backup key securely
aws secretsmanager create-secret \
  --name prod/mev-bot/encryption-key \
  --secret-string $(cat .secrets.key)

# On EC2 - fetch at startup
aws secretsmanager get-secret-value \
  --secret-id prod/mev-bot/encryption-key \
  --query SecretString \
  --output text > .secrets.key

# Set permissions
chmod 400 .secrets.key
```

### Option 2: HashiCorp Vault

```bash
vault kv put secret/mev-bot/encryption-key \
  key=@.secrets.key

# On EC2
vault kv get -field=key secret/mev-bot/encryption-key > .secrets.key
chmod 400 .secrets.key
```

### Option 3: Manual Secure Transfer

```bash
# On local machine - create encrypted backup
openssl enc -aes-256-cbc -salt -in .secrets.key -out .secrets.key.enc

# Transfer securely (SSH, secure messaging, etc.)
scp -i key.pem .secrets.key.enc ubuntu@ec2-instance:~/

# On EC2 - decrypt and setup
openssl enc -aes-256-cbc -d -in .secrets.key.enc -out .secrets.key
chmod 400 .secrets.key
```

## Troubleshooting

### "PRIVATE_KEY not found in encrypted storage"

**Solution:** Run initialization script:
```bash
npx ts-node scripts/init-secrets.ts
```

### Encryption key lost or corrupted

**Problem:** `Error: Failed to encrypt/decrypt secrets`

**Recovery:**
```bash
# If you have backup of .secrets.key:
cp ~/.mev-bot-backup.key .secrets.key
chmod 400 .secrets.key

# If you don't have backup - regenerate:
rm .secrets.enc
npm run init-secrets  # Will create new encrypted storage
```

### Change a Secret

```bash
# To update PRIVATE_KEY in encrypted storage:
# Option 1: Re-run init script (re-initializes everything from env)
npx ts-node scripts/init-secrets.ts

# Option 2: Manually (create utility function if needed)
# Delete .secrets.enc and re-initialize

# Then restart your bot:
npx ts-node scripts/mempool-listener.ts
```

### Verify Secrets are Encrypted

```bash
# Check file permissions (should be -rw-------)
ls -la .secrets.*

# Verify it's not readable as text
cat .secrets.enc | head -c 100  # Should show binary garbage, not your key

# Verify decryption works
npx ts-node -e "
  import { listSecretKeys } from './scripts/secrets-manager.ts';
  console.log('✅ Secrets found:', listSecretKeys());
"
```

## Migration Checklist

- [ ] Run `npx ts-node scripts/init-secrets.ts`
- [ ] Verify `.secrets.enc` and `.secrets.key` created
- [ ] Backup `.secrets.key` securely
- [ ] Add `.secrets.key` to `.gitignore`
- [ ] Clean up sensitive values from `.env`
- [ ] Test: `npx ts-node scripts/mempool-listener.ts`
- [ ] Verify "🔐 Loaded PRIVATE_KEY" message appears
- [ ] Commit `.env.example` instead of `.env`
- [ ] Remove old `.env` from git history if needed:
  ```bash
  git filter-branch --tree-filter 'rm -f .env' --prune-empty HEAD
  git push origin --force
  ```

## Advanced Topics

### Custom Secrets

To add a new secret beyond the defaults:

```typescript
import { storeSecret, getSecret } from "./scripts/secrets-manager.ts";

// Store any custom secret
storeSecret("MY_CUSTOM_API_KEY", "secret-value-here");

// Retrieve it later
const value = getSecret("MY_CUSTOM_API_KEY");
```

### Key Rotation

```bash
# 1. Generate new encryption key
openssl rand -hex 32 > .secrets.key.new

# 2. Decrypt with old key, encrypt with new key
# (Need to implement rotation function)

# 3. Replace old key
mv .secrets.key.new .secrets.key
chmod 400 .secrets.key

# 4. Backup new key
```

### Environment-Specific Keys

```typescript
// Load different keys based on environment
const env = process.env.NODE_ENV || 'development';
const keyName = env === 'production' ? 'PRIVATE_KEY_PROD' : 'PRIVATE_KEY_DEV';
const privateKey = loadSecret(keyName);
```

## Support & Questions

For issues or questions:
1. Check the [Troubleshooting](#troubleshooting) section
2. Review the [Security Best Practices](#security-best-practices)
3. Check logs for error messages
4. Verify file permissions with `ls -la .secrets.*`

---

**🔐 Your private keys are now protected with enterprise-grade encryption!**
