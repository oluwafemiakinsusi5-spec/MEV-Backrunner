import { ethers } from "ethers";

/**
 * ERC20 Token Approval Manager
 * Handles approvals for DEX routers
 * Caches approval states to avoid redundant approvals
 */

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
];

const APPROVAL_CACHE = new Map<string, { expireAt: number; amount: bigint }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Ensure a wallet has approved a token to a spender (DEX router, etc.)
 */
export async function ensureApproved(
  wallet: ethers.Wallet,
  tokenAddress: string,
  spenderAddress: string,
  amount: bigint
): Promise<boolean> {
  const cacheKey = `${tokenAddress}:${spenderAddress}`;

  // Check cache first
  const cached = APPROVAL_CACHE.get(cacheKey);
  if (cached && cached.expireAt > Date.now() && cached.amount >= amount) {
    console.log(
      `   ✅ Approval cached for ${tokenAddress.slice(0, 6)}... → ${spenderAddress.slice(0, 6)}...`
    );
    return true;
  }

  try {
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);

    // Check current allowance
    const currentAllowance = await token.allowance(wallet.address, spenderAddress);

    if (currentAllowance >= amount) {
      // Already approved
      APPROVAL_CACHE.set(cacheKey, {
        expireAt: Date.now() + CACHE_TTL,
        amount: currentAllowance,
      });
      console.log(
        `   ✅ Already approved: ${ethers.formatUnits(currentAllowance, 18)} (need ${ethers.formatUnits(amount, 18)})`
      );
      return true;
    }

    // Need to approve – use unlimited amount for batch efficiency
    console.log(`   📝 Approving ${tokenAddress.slice(0, 6)}... for ${spenderAddress.slice(0, 6)}...`);
    const approveTx = await token.approve(spenderAddress, ethers.MaxUint256);
    const receipt = await approveTx.wait();

    if (receipt?.status === 1) {
      APPROVAL_CACHE.set(cacheKey, {
        expireAt: Date.now() + CACHE_TTL,
        amount: ethers.MaxUint256,
      });
      console.log(`   ✅ Approval successful: ${approveTx.hash}`);
      return true;
    }

    return false;
  } catch (error: any) {
    console.warn(
      `   ⚠️  Approval failed: ${error.message || error}`
    );
    return false;
  }
}

/**
 * Clear approval cache (useful if switching networks/wallets)
 */
export function clearApprovalCache() {
  APPROVAL_CACHE.clear();
  console.log(`🧹 Approval cache cleared`);
}

/**
 * Pre-approve common DEX routers for a set of tokens
 */
export async function preApproveTokens(
  wallet: ethers.Wallet,
  tokens: string[],
  spenders: Record<string, string>
): Promise<number> {
  let approved = 0;

  for (const token of tokens) {
    for (const [name, spender] of Object.entries(spenders)) {
      const success = await ensureApproved(wallet, token, spender, ethers.MaxUint256);
      if (success) approved++;
    }
  }

  return approved;
}
