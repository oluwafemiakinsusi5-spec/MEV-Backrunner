# BackrunExecutor Contract Setup

## What it does

The `BackrunExecutor.sol` smart contract enables atomic backrun execution:

1. **Flash borrows** tokens from Aave V3 (0.05% fee, no upfront capital)
2. **Executes a backrun swap** on QuickSwap to capture MEV
3. **Repays** the flash loan + fee atomically
4. **Keeps the profit** for the bot owner

All in a single transaction – no risk of partial execution or losing capital.

---

## Prerequisites

- Node.js + Hardhat configured for Polygon
- Private key with some MATIC for gas (~0.5 MATIC for deployment)
- Alchemy API key

---

## Deployment Steps

### 1. Compile the contract

```bash
npx hardhat compile
```

This generates the ABI and bytecode.

### 2. Deploy to Polygon

```bash
npx hardhat run scripts/deploy-backrun.ts --network polygon
```

Output will show the deployed contract address. Example:
```
✅ BackrunExecutor deployed to: 0x1234567890abcdef1234567890abcdef12345678
```

### 3. Update .env

Add the deployed contract address:

```dotenv
BACKRUN_CONTRACT=0x1234567890abcdef1234567890abcdef12345678
```

---

## How the backrun flow works

```
┌─────────────┐
│    Bot      │
│(mempool     │ 1. Detects high-impact pending swap
│ listener)   │ 2. Calculates potential profit
└──────┬──────┘ 3. Calls BackrunExecutor.executeBackrun()
       │
       ├─→ Tx 1: Your backrun TX (calls smart contract)
       │   │
       │   ├─→ Aave flashLoan triggered
       │   │   │
       │   ├─→ executeOperation callback
       │   │   │
       │   ├─→ Approve QuickSwap router
       │   │
       │   ├─→ Swap borrowed token for output
       │   │   (victim's TX also executed, price moves)
       │   │
       │   ├─→ Repay Aave (amount + 0.05% fee)
       │   │
       │   └─→ Send profit to your wallet
       │
       └─→ Gas: ~150k-200k gas (~0.05 MATIC at 50 gwei)
```

---

## Example backrun scenario

**Victim's TX (pending):**
- Swap: 10 USDC → MATIC
- Expected output @ mid-price: ~50 MATIC
- But victim gets ~49.5 MATIC (0.5% slippage from impact)

**Your backrun (after victim confirms):**
1. Flash borrow 10 USDC (-0.05% fee = 10.005 USDC repay)
2. Swap 10 USDC → MATIC
   - Price is now better (victim moved it in your favor)
   - You get ~50.5 MATIC
3. Repay Aave 10.005 USDC (if output token is USDC)
4. **Keep the difference as profit**

If output is different token (MATIC), contract handles conversion or requires sufficient output to cover fee.

---

## Gas & Costs

| Item             | Cost           |
|------------------|----------------|
| Flash loan fee   | 0.05% of amount |
| Swap fee (DEX)   | 0.3% (QuickSwap) |
| Tx gas           | ~150k gas       |
| Gas at 50 gwei   | ~0.0075 MATIC   |
| **Total if fail** | Loss = gas only |
| **Total if win** | Profit - (loan fee + swap fee + gas) |

---

## Safety considerations

- ✅ **Only owner** can call `executeBackrun()`
- ✅ **Reentrancy guards** prevent exploit
- ✅ **Atomic transactions** – no risk of partial execution
- ✅ **Flash loan repaid automatically** before your profit is sent
- ⚠️ **Slippage risk** – if output < loan fee, tx reverts and only lose gas

---

## Troubleshooting

### "Insufficient output to cover loan + fee"

Your expected output is too low. The contract couldn't get enough tokens from the swap to repay the flash loan + fee.
- Raise `amountOutMin` to match actual expected output
- Or the MEV opportunity isn't profitable

### "Only owner" error

Your wallet isn't the contract owner. Redeploy or use the private key that deployed.

### High gas revert

Gas price spiked. Try again when network is less congested.

---

## Next steps

1. Deploy the contract
2. Update `.env` with `BACKRUN_CONTRACT=0x...`
3. Listener will automatically call the contract when backrun conditions are met
4. Monitor `npm run analytics` to see backrun profits

---

## Verifying on Polygon

Visit Polygonscan and paste your contract address:
```
https://polygonscan.com/address/YOUR_CONTRACT_ADDRESS
```

You can see all transactions initiated and profits sent to your wallet.
