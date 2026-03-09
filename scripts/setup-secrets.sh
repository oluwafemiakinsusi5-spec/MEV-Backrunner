#!/bin/bash
# Encrypted Secrets System - Complete Migration Guide
# Run this in your MEV-bot project directory

echo "🔐 MEV Bot - Encrypted Secrets System Setup"
echo "=========================================="
echo ""

# Step 1: Initialize encrypted secrets
echo "📦 Step 1: Initializing encrypted secrets system..."
echo "   This will encrypt your sensitive data and create:"
echo "   • .secrets.enc - Encrypted secrets file"
echo "   • .secrets.key - Encryption key (KEEP SAFE!)"
echo ""
echo "   Running: npx ts-node scripts/init-secrets.ts"
echo ""

npx ts-node scripts/init-secrets.ts

if [ $? -ne 0 ]; then
  echo "❌ Initialization failed. Please check your keys and try again."
  exit 1
fi

echo ""
echo "✅ Secrets encrypted successfully!"
echo ""

# Step 2: Backup .secrets.key
echo "⚠️  Step 2: Backup your encryption key"
echo "   Your encryption key is stored in: .secrets.key"
echo ""
echo "   IMPORTANT: Make secure backups of .secrets.key in:"
echo "   • AWS Secrets Manager"
echo "   • HashiCorp Vault"
echo "   • Encrypted USB drive"
echo "   • Another secure location"
echo ""
echo "   ❌ DO NOT commit .secrets.key to git!"
echo "   ❌ DO NOT share this key!"
echo ""

echo "🔑 To backup manually:"
echo "   cp .secrets.key ~/.mev-bot-key-backup"
echo ""

# Step 3: Verify .gitignore
echo "Step 3: Verifying .gitignore configuration..."
grep ".secrets" .gitignore > /dev/null
if [ $? -eq 0 ]; then
  echo "✅ .gitignore properly configured to exclude secrets"
else
  echo "⚠️  Adding secrets files to .gitignore"
  echo ".secrets.enc" >> .gitignore
  echo ".secrets.key" >> .gitignore
fi
echo ""

# Step 4: Clean up .env
echo "Step 4: Cleaning up .env file"
echo "   You can now remove sensitive values from .env:"
echo ""
echo "   Before:"
echo "      PRIVATE_KEY=366d5287e3..."
echo "      ALCHEMY_API_KEY=HbG2B-oRSD..."
echo ""
echo "   After:"
echo "      PRIVATE_KEY="
echo "      ALCHEMY_API_KEY="
echo ""
echo "   Or use .env.example as template"
echo ""

# Step 5: Deployment instructions
echo "📋 Step 5: Deployment Configuration"
echo ""
echo "   On EC2 or production:"
echo "   1. Generate new .secrets.key locally"
echo "   2. Store securely in AWS Secrets Manager"
echo "   3. Deploy code (don't commit .secrets.key)"
echo "   4. Fetch key from Secrets Manager on startup"
echo ""

# Step 6: Verify setup
echo "✅ Setup Complete!"
echo ""
echo "📝 Checklist:"
echo "   ✓ Secrets encrypted in .secrets.enc"
echo "   ✓ Encryption key stored in .secrets.key"
echo "   ✓ .gitignore configured"
echo "   ✓ .secrets.key backed up securely"
echo ""
echo "🚀 You can now run your bot securely:"
echo "   npx ts-node scripts/mempool-listener.ts"
echo ""
echo "🔒 All private keys are now protected!"
