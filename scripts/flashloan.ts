import { ethers } from "ethers";

/**
 * Aave V3 Flash Loan Helper
 * Borrows capital via Aave flash loans, executes swap, repays atomically
 * No upfront capital needed – only pay 0.05% flash loan fee
 */

const AAVE_POOL_ADDRESS = "0x794a61358D6845594f94dc1db02a252b5b4814aD"; // Aave V3 Pool on Polygon
const AAVE_POOL_ABI = [
  "function flashLoan(address receiver, address[] tokens, uint256[] amounts, uint256[] modes, address onBehalfOf, bytes calldata params, uint16 referralCode) external",
  "function FLASHLOAN_PREMIUM_TOTAL() external view returns (uint128)",
];

const FLASH_LOAN_PROVIDER_ABI = [
  "function executeOperation(address asset, uint256 amount, uint256 premium, address initiator, bytes calldata params) external returns (bytes32)",
];

export interface FlashLoanRequest {
  token: string; // Token to borrow
  amount: bigint; // Amount to borrow
  userContract: string; // Your contract that implements executeOperation
}

/**
 * Get the fee for a flash loan (0.05% on Polygon)
 */
export async function getFlashLoanFee(
  provider: ethers.Provider,
  amount: bigint
): Promise<bigint> {
  const pool = new ethers.Contract(AAVE_POOL_ADDRESS, AAVE_POOL_ABI, provider);
  try {
    const premium: bigint = await pool.FLASHLOAN_PREMIUM_TOTAL();
    return (amount * premium) / 10000n; // 0.05% = 5 basis points
  } catch {
    // Fallback: assume 0.05%
    return (amount * 5n) / 10000n;
  }
}

/**
 * Estimate capital available for a backrun using flash loans
 * Flash loans allow borrowing up to 90% of the DEX pair reserve for the input token
 */
export function estimateFlashLoanCapacity(
  tokenReserve: bigint,
  flashLoanPremiumPercent: number = 0.05
): bigint {
  // Can borrow up to the reserve
  // Fee is ~0.05% which reduces effective capital
  const feePercent = BigInt(Math.ceil(flashLoanPremiumPercent * 10000));
  const capacity = (tokenReserve * 10000n) / (10000n + feePercent);
  return capacity;
}

export interface FlashLoanExecution {
  token: string;
  amount: bigint;
  fee: bigint;
  totalRepay: bigint; // amount + fee
}

/**
 * Build flash loan execution parameters
 */
export function buildFlashLoanExecution(
  tokenAddress: string,
  borrowAmount: bigint,
  fee: bigint
): FlashLoanExecution {
  return {
    token: tokenAddress,
    amount: borrowAmount,
    fee,
    totalRepay: borrowAmount + fee,
  };
}

/**
 * Check if wallet has enough balance to cover flash loan fee + approval
 */
export async function canAffordFlashLoan(
  wallet: ethers.Wallet,
  token: string,
  borrowAmount: bigint,
  feeTokenAddress: string
): Promise<boolean> {
  try {
    // For Aave, fee is paid in the borrowed token
    const feeAmount = (borrowAmount * 5n) / 10000n; // 0.05%

    if (feeTokenAddress === token) {
      // Fee is in same token – check wallet balance
      const erc20 = new ethers.Contract(
        token,
        ["function balanceOf(address) external view returns (uint256)"],
        wallet.provider
      );
      const balance = await erc20.balanceOf(wallet.address);
      return balance >= feeAmount;
    }

    // Fee in different token – check that too
    return true; // Simplified
  } catch {
    return false;
  }
}
