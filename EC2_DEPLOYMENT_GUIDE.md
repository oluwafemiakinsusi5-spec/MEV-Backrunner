# MEV Backrunner EC2 Deployment Guide (Windows Server)

This guide covers deploying the MEV Backrunner bot on Amazon EC2 Windows Server instance (hostname: mev-backrunner).

---

## Prerequisites

- AWS Account
- RDP or Session Manager access to EC2
- Alchemy API key (Polygon mainnet WebSocket + HTTP)
- Private key with MATIC balance for backrun transactions

---

## EC2 Instance Setup (Windows)

### 1. Launch EC2 Instance

**Recommended Instance Type:**
- `t3.large` (2 vCPU, 8GB RAM) minimum
- `t3.xlarge` (4 vCPU, 16GB RAM) recommended for production

**AMI:** Windows Server 2022 Base (or 2019)

**Storage:** 50GB gp3 SSD

**Security Group:**
```
Inbound:
- RDP (3389): Your IP only
- Custom TCP (3000): Your IP only (for monitoring)

Outbound:
- All traffic: Allowed
```

### 2. Connect via RDP

1. Download RDP client
2. Connect using your Windows admin credentials
3. Default: Administrator / Get instance password from AWS Console

### 3. Change Computer Name to mev-backrunner

1. Right-click Start → System
2. Click "Rename this PC"
3. Enter: `mev-backrunner`
4. Restart when prompted

---

## Node.js Installation (Windows)

### Option 1: Direct Download

1. Download Node.js 20.x LTS: https://nodejs.org/dist/v20.18.1/node-v20.18.1-x64.msi
2. Run installer
3. Verify in Command Prompt:
```cmd
node --version
npm --version
```

### Option 2: Winget (Recommended)

```cmd
winget install OpenJS.NodeJS.LTS
```

---

## Project Setup

### 1. Upload Project Files

**Option A: Git Clone**
```cmd
git clone <your-repo-url> C:\mev-backrunner
cd C:\mev-backrunner
```

**Option B: Upload via S3**
1. Zip project folder
2. Upload to S3 bucket
3. Download and extract on EC2

**Option B: Remote Desktop Copy**
1. Copy folder from local PC
2. Paste into RDP session

### 2. Install Dependencies

```cmd
cd C:\mev-backrunner
npm install
```

### 3. Configure Environment Variables

Create `.env` file in `C:\mev-backrunner`:

```env
# Alchemy API (REQUIRED)
ALCHEMY_WS_URL=wss://polygon-mainnet.g.alchemy.com/v2/YOUR-API-KEY
ALCHEMY_HTTP_URL=https://polygon-mainnet.g.alchemy.com/v2/YOUR-API-KEY

# Private Key (REQUIRED for backrun)
PRIVATE_KEY=0xyour-private-key-without-0x

# Backrun Configuration
BACKRUN_ENABLED=1
BACKRUN_IMPACT_THRESHOLD=0.5

# Optional: Monitoring
MONITORING_ENABLED=yes
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx

# Optional: Filters
MIN_AMOUNTIN=1000000000000000000
```

### 4. Compile Smart Contract

```cmd
npx hardhat compile
```

### 5. Deploy Contract (First Time Only)

```cmd
npx hardhat run scripts/deploy-backrun.ts --network polygon
```

Copy the deployed contract address to `.env`:

```env
BACKRUN_CONTRACT=0xYourContractAddress
```

---

## Running the Bot (Windows)

### Option 1: Command Prompt (Development)

```cmd
cd C:\mev-backrunner
npm run start
```

### Option 2: PowerShell Background Job

```powershell
Start-Job -ScriptBlock {
    Set-Location C:\mev-backrunner
    npm run start
} -Name "MEV-Backrunner"

# Check status
Get-Job -Name "MEV-Backrunner"

# Stop
Stop-Job -Name "MEV-Backrunner"
Remove-Job -Name "MEV-Backrunner"
```

### Option 3: Windows Service (Production Recommended)

Create a Windows Service using NSSM:

**Step 1: Download NSSM**
1. Download: https://nssm.cc/download
2. Extract to `C:\nssm\nssm.exe`

**Step 2: Create Service**

Open Command Prompt as Administrator:

```cmd
cd C:\nssm
nssm.exe install MEVBackrunner "C:\Program Files\nodejs\node.exe" "C:\mev-backrunner\node_modules\ts-node\dist\bin.js C:\mev-backrunner\scripts\mempool-listener.ts"
nssm.exe set MEVBackrunner AppDirectory "C:\mev-backrunner"
nssm.exe set MEVBackrunner DisplayName "MEV Backrunner Bot"
nssm.exe set MEVBackrunner Description "MEV Backrunner - Polygon DEX Monitor"
nssm.exe set MEVBackrunner Start SERVICE_AUTO_START
nssm.exe set MEVBackrunner RestartServiceDelay 10000
```

**Step 3: Start/Stop Service**

```cmd
# Start
net start MEVBackrunner

# Stop
net stop MEVBackrunner

# Check status
sc query MEVBackrunner
```

**Step 4: Configure Recovery Options**

```cmd
sc failure MEVBackrunner reset= 86400 actions= restart/10000/restart/10000/restart/10000
```

---

## Monitoring & Logs

### View Logs (PowerShell)

```powershell
# NSSM logs (default location)
Get-Content "C:\mev-backrunner\logs\stdout.log" -Tail 50 -Wait

# Event Viewer
Get-EventLog -LogName Application -Source "MEVBackrunner" -Newest 20
```

### Check Bot Status

```cmd
# Service status
sc query MEVBackrunner

# Task Manager
tasklist | findstr node
```

### Resource Monitoring

- Task Manager
- Resource Monitor (resmon)
- AWS CloudWatch

---

## Auto-Restart on Failure

### Option 1: NSSM Built-in

NSSM already configured with automatic restart (see above).

### Option 2: Scheduled Task

Create in Task Scheduler:

1. Open Task Scheduler (taskschd.msc)
2. Create Basic Task:
   - Name: MEV-Bot-HealthCheck
   - Trigger: Every 5 minutes
3. Action: Start a program
4. Program: `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`
5. Arguments: `-ExecutionPolicy Bypass -File C:\mev-backrunner\health-check.ps1`

Create `C:\mev-backrunner\health-check.ps1`:

```powershell
$service = Get-Service -Name "MEVBackrunner" -ErrorAction SilentlyContinue
if ($service.Status -ne "Running") {
    Write-Host "$(Get-Date): Bot not running, restarting..."
    Start-Service -Name "MEVBackrunner"
}
```

---

## Updating the Bot

```cmd
# Navigate to directory
cd C:\mev-backrunner

# Pull latest changes (if using git)
git pull

# Install any new dependencies
npm install

# Recompile contracts (if updated)
npx hardhat compile

# Restart service
net stop MEVBackrunner
net start MEVBackrunner
```

---

## Backup & Security

### Backup Important Files

```cmd
# Backup .env (contains private key)
copy C:\mev-backrunner\.env C:\mev-backrunner\.env.backup

# Backup database
copy C:\mev-backrunner\mev_tracker.sqlite C:\mev-backrunner\mev_tracker.sqlite.backup
```

### Security Checklist

- [ ] Use IAM role for AWS access (not hardcoded keys)
- [ ] Use AWS Secrets Manager for private keys
- [ ] Enable CloudWatch monitoring
- [ ] Set up billing alerts
- [ ] Use Windows Firewall
- [ ] Enable RDP only from your IP

---

## Troubleshooting

### Bot not starting

1. Check Event Viewer → Windows Logs → Application
2. Common issues:
   - Missing .env variables
   - Alchemy API key invalid
   - Contract not deployed
   - Node version incompatible

### WebSocket connection issues

```powershell
# Test Alchemy connection
Test-NetConnection -ComputerName "polygon-mainnet.g.alchemy.com" -Port 443

# Check firewall
Get-NetFirewallRule | Where-Object { $_.DisplayName -like "*node*" }
```

### Out of memory

Increase pagefile:
1. System Properties → Performance → Settings → Advanced
2. Virtual Memory → Change
3. Set to 16384 MB (16GB)

---

## Quick Reference

| Command | Description |
|---------|-------------|
| `net start MEVBackrunner` | Start bot |
| `net stop MEVBackrunner` | Stop bot |
| `sc query MEVBackrunner` | Check status |
| `nssm.exe restart MEVBackrunner` | Restart bot |

---

## Production Checklist

- [ ] Use t3.xlarge or larger instance
- [ ] Set up CloudWatch alarms
- [ ] Configure Slack/Discord alerts
- [ ] Enable automated backups (S3)
- [ ] Use hardware wallet or AWS KMS for signing
- [ ] Configure VPC with private subnet
- [ ] Enable Windows Defender

---

## Useful PowerShell Commands

```powershell
# Start bot
Start-Service -Name "MEVBackrunner"

# Stop bot  
Stop-Service -Name "MEVBackrunner"

# Restart bot
Restart-Service -Name "MEVBackrunner"

# View logs (live)
Get-Content "C:\mev-backrunner\logs\stdout.log" -Wait -Tail 20

# Check if running
Get-Process -Name "node" -ErrorAction SilentlyContinue

# Kill node process (if needed)
Get-Process -Name "node" | Stop-Process -Force
```

---

**Note:** This bot handles real funds. Always test thoroughly on testnet before production deployment.

