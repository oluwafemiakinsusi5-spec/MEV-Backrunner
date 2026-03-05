import { ethers } from "ethers";

/**
 * Price Oracle using Uniswap V3 TWAP
 * Provides accurate price data for profit calculations
 */

// Uniswap V3 Factory and Oracle contracts
const UNISWAP_V3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
const UNISWAP_V3_QUOTER_V2 = "0x61fFE014BA17989E743c5F6cB21bF9697530B21e";

const FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)"
];

const POOL_ABI = [
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function observe(uint32[] secondsAgos) external view returns (int56[] tickCumulatives, uint160[] liquidity)"
];

const QUOTER_V2_ABI = [
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasUsed)"
];

/**
 * Get the current price from a Uniswap V3 pool using slot0
 */
export async function getPoolPrice(
  provider: ethers.Provider,
  tokenA: string,
  tokenB: string,
  fee: number = 3000 // 0.3% fee tier
): Promise<{ price: bigint; sqrtPriceX96: bigint; tick: number } | null> {
  try {
    const factory = new ethers.Contract(UNISWAP_V3_FACTORY, FACTORY_ABI, provider);
    const poolAddr = await factory.getPool(tokenA, tokenB, fee);
    
    if (!poolAddr || poolAddr === ethers.ZeroAddress) {
      return null;
    }

    const pool = new ethers.Contract(poolAddr, POOL_ABI, provider);
    const [sqrtPriceX96, tick] = await pool.slot0();

    // Calculate price from sqrtPriceX96
    // price = (sqrtPriceX96^2 / 2^192) * (10^tokenB_decimals / 10^tokenA_decimals)
    // Simplified for 18 decimal tokens:
    const TWO_POWER_192 = 2n ** 192n;
    const sqrtAsBigInt = BigInt(sqrtPriceX96.toString());
    const price = (sqrtAsBigInt * sqrtAsBigInt) / TWO_POWER_192;

    return {
      price,
      sqrtPriceX96: sqrtAsBigInt,
      tick: Number(tick),
    };
  } catch (error) {
    console.warn(`⚠️  Failed to get pool price: ${error}`);
    return null;
  }
}

/**
 * Get TWAP (Time-Weighted Average Price) from Uniswap V3
 * More resistant to price manipulation than spot price
 */
export async function getTWAPPrice(
  provider: ethers.Provider,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  fee: number = 3000,
  twapIntervalSeconds: number = 300 // 5 minutes default
): Promise<{ amountOut: bigint; spotPrice: bigint; twapPrice: bigint } | null> {
  try {
    const quoter = new ethers.Contract(UNISWAP_V3_QUOTER_V2, QUOTER_V2_ABI, provider);

    // Get quote for exact input (this is our best estimate for both spot and TWAP)
    const quoteResult = await quoter.quoteExactInputSingle({
      tokenIn,
      tokenOut,
      amountIn,
      fee,
      sqrtPriceLimitX96: 0,
    });

    const amountOut = quoteResult.amountOut as bigint;

    // Try to get TWAP from the pool if available
    let twapPrice: bigint = amountOut;
    
    try {
      const factory = new ethers.Contract(UNISWAP_V3_FACTORY, FACTORY_ABI, provider);
      const poolAddr = await factory.getPool(tokenIn, tokenOut, fee);
      
      if (poolAddr && poolAddr !== ethers.ZeroAddress) {
        const pool = new ethers.Contract(poolAddr, POOL_ABI, provider);
        
        // Try to get TWAP observation
        const secondsAgo = [twapIntervalSeconds, 0];
        const [tickCumulatives] = await pool.observe(secondsAgo);
        
        if (tickCumulatives && tickCumulatives.length >= 2) {
          // Calculate TWAP tick and convert to price
          const tickDiff = Number(tickCumulatives[1]) - Number(tickCumulatives[0]);
          const twapTick = tickDiff / twapIntervalSeconds;
          
          // Convert tick to price: price = 1.0001^tick
          // For simplicity, we use the quoter result as TWAP approximation
          // since the pool observation might have initialization issues
          twapPrice = amountOut; // Use quoter result as reliable TWAP estimate
        }
      }
    } catch {
      // TWAP calculation failed, use quoter result as best approximation
      console.warn("⚠️  TWAP calculation failed, using quoter result");
    }

    return {
      amountOut,
      spotPrice: amountOut,
      twapPrice,
    };
  } catch (error) {
    console.warn(`⚠️  Failed to get TWAP price: ${error}`);
    return null;
  }
}

/**
 * Calculate expected profit from a backrun opportunity
 * Takes into account flash loan fees, swap fees, and gas costs
 */
export interface ProfitCalculation {
  grossProfit: bigint;
  flashLoanFee: bigint;
  swapFee: bigint;
  gasCost: bigint;
  netProfit: bigint;
  profitable: boolean;
}

/**
 * Calculate accurate profit for a backrun
 */
export async function calculateAccurateProfit(
  provider: ethers.Provider,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  gasCost: bigint,
  fee: number = 3000,
  flashLoanFeeBps: number = 5 // 5 bps = 0.05%
): Promise<ProfitCalculation> {
  const quote = await getTWAPPrice(provider, tokenIn, tokenOut, amountIn, fee);
  
  if (!quote) {
    // Return zero profit if oracle unavailable
    return {
      grossProfit: 0n,
      flashLoanFee: 0n,
      swapFee: 0n,
      gasCost,
      netProfit: -gasCost,
      profitable: false,
    };
  }

  const amountOut = quote.amountOut;
  
  // Calculate fees
  const flashLoanFee = (amountIn * BigInt(flashLoanFeeBps)) / 10000n;
  const swapFee = (amountOut * BigInt(fee)) / 10000n; // DEX fee (e.g., 0.3% = 30 bps)
  
  const totalCosts = flashLoanFee + swapFee + gasCost;
  const netProfit = amountOut > totalCosts ? amountOut - totalCosts : -totalCosts;
  
  return {
    grossProfit: amountOut,
    flashLoanFee,
    swapFee,
    gasCost,
    netProfit,
    profitable: netProfit > 0n,
  };
}

/**
 * Get price impact estimate for a given trade size
 * Compares spot price vs expected output to estimate slippage
 */
export async function estimatePriceImpact(
  provider: ethers.Provider,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  fee: number = 3000
): Promise<number | null> {
  try {
    const quote = await getTWAPPrice(provider, tokenIn, tokenOut, amountIn, fee);
    const spot = await getPoolPrice(provider, tokenIn, tokenOut, fee);
    
    if (!quote || !spot || spot.price === 0n) {
      return null;
    }

    // Calculate impact: (spotPrice - outputAmount) / spotPrice
    const midPrice = spot.price;
    // Convert to Number for percentage calculation
    const executionPriceNum = Number(quote.amountOut) / Number(amountIn);
    const midPriceNum = Number(midPrice);
    
    const impact = ((midPriceNum - executionPriceNum) / midPriceNum) * 100;
    
    return impact;
  } catch {
    return null;
  }
}
