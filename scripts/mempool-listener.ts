import "dotenv/config";
import { ethers } from "ethers";
import * as database from "./database.ts";
import * as confirmationMonitor from "./confirmation-monitor.ts";
import * as backrunExecutor from "./backrun-executor.ts";
import * as priceOracle from "./price-oracle.ts";
import * as sandwichDetector from "./sandwich-detector.ts";

/**
 * MEV Listener - DEX Swap Monitor
 * Monitors pending SWAP transactions on Polygon DEXes
 * Filters for known DEX routers and swap function calls only
 * Displays transaction details without executing any transactions
 * 
 * ✅ No signing
 * ✅ No gas costs
 * ✅ No risk
 */

// Known DEX Router Addresses on Polygon
const DEX_ROUTERS = {
  quickswap_v2: "0xa5e0829caced8ffdd4de3c43696c57f7d7a678ff", // QuickSwap V2
  quickswap_v3: "0xf5b509bb0fdce6b81cb75007dc2b92aa46b42dcd", // QuickSwap V3 Router
  uniswap_v3: "0x68b3465833fb72B5A828cCEEf294e3541EB8f3Df", // Uniswap V3 SwapRouter
} as const;

// Swap Function Selectors (first 4 bytes of function signature)
const SWAP_FUNCTIONS = {
  // QuickSwap/Uniswap V2-style
  swapExactTokensForTokens: "0x38ed1739",
  swapTokensForExactTokens: "0x8803dbee",
  swapExactETHForTokens: "0x7ff36ab5",
  swapTokensForExactETH: "0x4a25d94a",
  swapExactTokensForETH: "0x18cbafe5",
  swapETHForExactTokens: "0xfb3bdb41",
  
  // Uniswap V3
  exactInputSingle: "0x414bf389",
  exactInput: "0xc04b8d59",
  exactOutputSingle: "0xfa461e33",
  exactOutput: "0xf28c0498",
  
  // Generic swap patterns
  swap: "0xd9627aa4", // Common swap selector
} as const;

// Configuration variables (set after validation in main())
let wsUrl = "";
let httpUrl = "";
let BACKRUN_ENABLED = false;
let BACKRUN_IMPACT_THRESHOLD = 0;
let wallet: ethers.Wallet | null = null;

// ====== Enhanced Connection Settings ======
// WebSocket connection timeout (default: 30 seconds, configurable)
const WS_CONNECTION_TIMEOUT = process.env.WS_CONNECTION_TIMEOUT 
  ? parseInt(process.env.WS_CONNECTION_TIMEOUT) 
  : 30000;

// Max retry attempts before giving up (default: 5)
const WS_MAX_RETRIES = process.env.WS_MAX_RETRIES 
  ? parseInt(process.env.WS_MAX_RETRIES) 
  : 5;

// Max backoff time in ms (default: 60 seconds)
const WS_RETRY_BACKOFF_MAX = process.env.WS_RETRY_BACKOFF_MAX 
  ? parseInt(process.env.WS_RETRY_BACKOFF_MAX) 
  : 60000;

// Fallback to HTTP polling if WebSocket fails (default: true)
const FALLBACK_TO_HTTP = process.env.FALLBACK_TO_HTTP === "true" || process.env.FALLBACK_TO_HTTP === "1";

// HTTP polling interval when using fallback mode (default: 1 second)
const HTTP_POLL_INTERVAL = process.env.HTTP_POLL_INTERVAL 
  ? parseInt(process.env.HTTP_POLL_INTERVAL) 
  : 1000;

// ====== Provider State ======
let wsProvider: ethers.WebSocketProvider;
let httpProvider: ethers.JsonRpcProvider;
let reconnectBackoff = 2000; // Start with 2 seconds
let connectionAttempts = 0;
let isUsingFallback = false;
let httpPollInterval: NodeJS.Timeout | null = null;

// Track seen transactions to avoid duplicates and support pruning
const seenTxs = new Map<string, number>(); // txHash -> timestamp
const SEEN_TX_TTL_MS = process.env.SEEN_TX_TTL_MS ? parseInt(process.env.SEEN_TX_TTL_MS) : 5 * 60 * 1000; // default 5m

// Rate limiting / cooldown
let activeRequests = 0;
const MAX_ACTIVE_REQUESTS = 5;
let cooldownUntil = 0; // timestamp in ms, skip fetching until then

// Additional user filters (optional via env)
const MIN_CALLDATA_BYTES = process.env.MIN_CALLDATA_BYTES ? parseInt(process.env.MIN_CALLDATA_BYTES) : 0;
// amountIn threshold (raw token units); e.g. 1000 -> 1000 (assumes token has 18 decimals)
const MIN_AMOUNTIN = process.env.MIN_AMOUNTIN ? BigInt(process.env.MIN_AMOUNTIN) : BigInt(0);
// Price impact range in percent; e.g. MIN=0.3, MAX=1.2 filters for swaps with 0.3% <= impact <= 1.2%
const MIN_PRICE_IMPACT_PERCENT = process.env.MIN_PRICE_IMPACT_PERCENT ? parseFloat(process.env.MIN_PRICE_IMPACT_PERCENT) : 0;
const MAX_PRICE_IMPACT_PERCENT = process.env.MAX_PRICE_IMPACT_PERCENT ? parseFloat(process.env.MAX_PRICE_IMPACT_PERCENT) : 100;

// ABIs for decoders by selector
const ABI_BY_SELECTOR: Record<string, string[]> = {
  "0x38ed1739": ["function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline)"],
  "0x8803dbee": ["function swapTokensForExactTokens(uint256 amountOut,uint256 amountInMax,address[] path,address to,uint256 deadline)"],
  "0x7ff36ab5": ["function swapExactETHForTokens(uint256 amountOutMin,address[] path,address to,uint256 deadline)"],
  "0x4a25d94a": ["function swapTokensForExactETH(uint256 amountOut,uint256 amountInMax,address[] path,address to,uint256 deadline)"],
  "0x18cbafe5": ["function swapExactTokensForETH(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline)"],
  "0xfb3bdb41": ["function swapETHForExactTokens(uint256 amountOut,address[] path,address to,uint256 deadline)"],
  "0x414bf389": ["function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96))"],
  "0xfa461e33": ["function exactOutputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountOut,uint256 amountInMaximum,uint160 sqrtPriceLimitX96))"],
  "0xc04b8d59": ["function exactInput((bytes path,uint256 amountIn,uint256 amountOutMinimum))"],
  "0xf28c0498": ["function exactOutput((bytes path,uint256 amountOut,uint256 amountInMaximum))"],
  "0xd9627aa4": ["function swap(address[] routes)"] // Generic swap ABI for basic decoding
};

// QuickSwap/Uniswap V2 factory and pair ABIs for reserves lookup
const FACTORY_ADDRESS = "0x5757371414417b8c6caad45baef941abc7d3ab32";
const FACTORY_ABI = ["function getPair(address tokenA,address tokenB) external view returns (address)"];
const PAIR_ABI = [
  "function getReserves() external view returns (uint112 reserve0,uint112 reserve1,uint32)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)"
];

async function simulatePriceImpact(amountIn: bigint, path: string[]): Promise<number | null> {
  if (path.length < 2) return null;
  const tokenA = path[0];
  const tokenB = path[1];
  const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, wsProvider);
  try {
    const pairAddr: string = await factory.getPair(tokenA, tokenB);
    if (!pairAddr || pairAddr === ethers.ZeroAddress) return null;
    const pair = new ethers.Contract(pairAddr, PAIR_ABI, wsProvider);
    const [res0, res1]: any = await pair.getReserves();
    const t0: string = await pair.token0();
    const reserveIn = t0.toLowerCase() === tokenA.toLowerCase() ? BigInt(res0.toString()) : BigInt(res1.toString());
    const reserveOut = t0.toLowerCase() === tokenA.toLowerCase() ? BigInt(res1.toString()) : BigInt(res0.toString());
    const amountInWithFee = amountIn * 997n;
    const numerator = amountInWithFee * reserveOut;
    const denominator = reserveIn * 1000n + amountInWithFee;
    const amountOut = numerator / denominator;
    const midPrice = Number(reserveOut) / Number(reserveIn);
    const executionPrice = Number(amountOut) / Number(amountIn);
    const impact = ((midPrice - executionPrice) / midPrice) * 100;
    return impact;
  } catch {
    return null;
  }
}


/**
 * Format address for display with DEX name if known
 */
function formatAddress(address: string): string {
  if (!address) return "N/A";
  const lowerAddr = address.toLowerCase();
  
  // Check if it's a known DEX router
  for (const [dex, addr] of Object.entries(DEX_ROUTERS)) {
    if (lowerAddr === addr) {
      return `${dex} (${address.slice(0, 6)}...${address.slice(-4)})`;
    }
  }
  
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Get DEX name from router address
 */
function getDexName(address: string): string {
  const lowerAddr = address.toLowerCase();
  for (const [dex, addr] of Object.entries(DEX_ROUTERS)) {
    if (lowerAddr === addr) {
      return dex.toUpperCase();
    }
  }
  return "UNKNOWN";
}

/**
 * Get function name from selector
 */
function getFunctionName(selector: string): string {
  for (const [name, sel] of Object.entries(SWAP_FUNCTIONS)) {
    if (sel === selector) {
      return name;
    }
  }
  return "UNKNOWN_SWAP";
}

/**
 * Format wei to MATIC
 */
function formatValue(wei: bigint): string {
  try {
    const maticValue = ethers.formatEther(wei);
    return `${maticValue} MATIC`;
  } catch {
    return "N/A";
  }
}

/**
 * Format gas price
 */
function formatGasPrice(gasPrice: bigint | null): string {
  if (!gasPrice) return "N/A";
  try {
    const gwei = ethers.formatUnits(gasPrice, "gwei");
    return `${gwei} gwei`;
  } catch {
    return "N/A";
  }
}

// pending transaction handler reused across reconnects
let swapCount = 0;
let filteredCount = 0;

// ------- Backrun helpers -------
async function attemptBackrun(txHash: string, dexRouter: string, selector: string, path: string[], amountIn: bigint, amountOutMin: bigint, impact: number) {
  if (!wallet) return;

  console.log(
    `🚀 Backrunning ${txHash.slice(0, 10)}... (impact ${impact.toFixed(2)}%)`
  );

  try {
    // Step 1: Check for competitors before executing
    console.log(`   🔍 Checking for competitors...`);
    const competitorCheck = await sandwichDetector.detectCompetitors(
      wsProvider,
      txHash,
      path,
      amountIn,
      dexRouter
    );

    console.log(`   📊 Competitors detected: ${competitorCheck.competitorCount}`);
    console.log(`   💡 Recommendation: ${competitorCheck.recommendation}`);

    // Skip if too many competitors
    if (competitorCheck.recommendation === "skip") {
      console.log(`   ⏭️  Skipping due to high competitor count`);
      return;
    }

    // Wait if moderate competition
    if (competitorCheck.recommendation === "wait") {
      console.log(`   ⏳ Waiting ${300}ms before proceeding...`);
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    // Step 2: Wait for victim transaction to be confirmed
    console.log(`   ⏱️  Waiting for victim tx confirmation...`);
    const victimTx = await wsProvider.getTransaction(txHash);
    if (!victimTx) {
      console.warn(`   ⚠️  Victim transaction not found`);
      return;
    }

    // Wait max 30 seconds for confirmation
    let confirmations = 0;
    let waitTime = 0;
    const maxWaitTime = 30000; // 30 seconds
    while (waitTime < maxWaitTime) {
      const receipt = await wsProvider.getTransactionReceipt(txHash);
      if (receipt) {
        // ethers v6: receipt.confirmations may be a function
        if (typeof receipt.confirmations === "function") {
          // @ts-ignore - confirmed to be function
          confirmations = Number(await (receipt.confirmations as any)());
        } else {
          // treat as number (cast via unknown to bypass function type)
          confirmations = (((receipt.confirmations as unknown) as number) || 1);
        }
        console.log(`   ✅ Victim tx confirmed (${confirmations} confirmations)`);
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
      waitTime += 500;
    }

    if (confirmations === 0) {
      console.warn(`   ⚠️  Victim tx not confirmed within timeout`);
      return;
    }

    // Step 3: Use price oracle for accurate profit calculation
    const httpProvider = new ethers.JsonRpcProvider(process.env.ALCHEMY_HTTP_URL || "");
    console.log(`   💰 Calculating accurate profit with price oracle...`);
    
    const gasCostEstimate = BigInt(200000) * (await wsProvider.getFeeData()).gasPrice!; // ~200k gas estimate
    const profitCalc = await priceOracle.calculateAccurateProfit(
      httpProvider,
      path[0],
      path[path.length - 1],
      amountIn,
      gasCostEstimate,
      3000 // 0.3% fee tier
    );

    console.log(`   📈 Gross profit: ${ethers.formatEther(profitCalc.grossProfit)} tokens`);
    console.log(`   ⛽ Total costs: ${ethers.formatEther(
      profitCalc.flashLoanFee + profitCalc.swapFee + profitCalc.gasCost
    )} tokens`);
    console.log(`   🎯 Net profit: ${ethers.formatEther(profitCalc.netProfit)} tokens`);

    if (!profitCalc.profitable) {
      console.log(`   ❌ Not profitable after accurate calculation`);
      return;
    }

    // Step 4: Calculate competitive gas price based on competitor count
    const feeData = await wallet.provider!.getFeeData();
    const currentGasPrice = feeData.gasPrice || 50000000000n;
    const competitiveGasPrice = await sandwichDetector.estimateCompetitiveGasPrice(
      wsProvider,
      currentGasPrice,
      competitorCheck.competitorCount
    );

    console.log(`   ⛽ Current gas: ${ethers.formatUnits(currentGasPrice, "gwei")} gwei`);
    console.log(`   🏎️  Competitive gas: ${ethers.formatUnits(competitiveGasPrice, "gwei")} gwei`);

    // Step 5: Execute backrun with optimized gas price
    const backrunParams: backrunExecutor.BackrunParams = {
      txHash,
      dexRouter,
      functionSelector: selector,
      path,
      amountIn,
      amountOutMin,
      walletAddress: wallet.address,
      gasPrice: competitiveGasPrice,
    };

    console.log(`   🚀 Executing backrun with competitive gas price...`);
    await backrunExecutor.executeBackrun(wallet, backrunParams);
    console.log(`   ✅ Backrun executed successfully!`);

  } catch (e: any) {
    console.warn(`   ⚠️  Backrun failed: ${e.message || e}`);
  }
}

async function handlePending(txHash: string) {
  // Skip if we've already processed this tx
  if (seenTxs.has(txHash)) return;
  seenTxs.set(txHash, Date.now());

  // global cooldown due to previous 429
  if (Date.now() < cooldownUntil) {
    filteredCount++;
    return;
  }

  // respect concurrency limit - increment BEFORE check to avoid race condition
  if (activeRequests >= MAX_ACTIVE_REQUESTS) {
    filteredCount++;
    return;
  }
  activeRequests++;
  try {
    // Get transaction details (read-only - just fetching data)
    const tx = await wsProvider.getTransaction(txHash);
    if (!tx) return;

    // FILTER 1: Check if recipient is a known DEX router
    if (!tx.to) {
      filteredCount++;
      return;
    }

    const toAddr = tx.to.toLowerCase();
    const isKnownDex = Object.values(DEX_ROUTERS).some(addr => addr === toAddr);
    if (!isKnownDex) {
      filteredCount++;
      return;
    }

    // FILTER 2: Check if function is a swap function (check first 4 bytes)
    if (!tx.data || tx.data.length < 10) {
      filteredCount++;
      return;
    }

    // optional calldata length filter
    if (MIN_CALLDATA_BYTES && tx.data.length < MIN_CALLDATA_BYTES) {
      filteredCount++;
      return;
    }

    const functionSelector = tx.data.substring(0, 10); // "0x" + 4 bytes
    const isSwapFunction = Object.values(SWAP_FUNCTIONS).includes(functionSelector as any);
    if (!isSwapFunction) {
      filteredCount++;
      return;
    }

    // decode transaction data once for filters and impact
    let funcNameOverride: string | undefined;
    let decodedTx: ethers.TransactionDescription | null = null;
    const abiList = ABI_BY_SELECTOR[functionSelector];
    if (abiList && abiList.length > 0) {
      try {
        const iface = new ethers.Interface(abiList);
        decodedTx = iface.parseTransaction({ data: tx.data });
      } catch {
        decodedTx = null;
      }
    }

    // amountIn filter
    if (MIN_AMOUNTIN && decodedTx && decodedTx.args) {
      const amountIn: bigint | undefined = decodedTx.args.amountIn || decodedTx.args.amountInMaximum || decodedTx.args.amountInMax;
      if (amountIn !== undefined && amountIn < MIN_AMOUNTIN) {
        filteredCount++;
        return;
      }
    }

    if (decodedTx && decodedTx.name) {
      funcNameOverride = decodedTx.name;
    }

    swapCount++;
    const dexName = getDexName(tx.to!);
    let funcName = getFunctionName(functionSelector);
    if (funcNameOverride) funcName = funcNameOverride;

    // simulate price impact if possible
    let impact: number | null = null;
    if (decodedTx && decodedTx.args) {
      const amountIn: bigint | undefined = decodedTx.args.amountIn || decodedTx.args.amountInMaximum || decodedTx.args.amountInMax;
      const path: string[] | undefined = decodedTx.args.path;
      if (amountIn !== undefined && path && path.length >= 2) {
        impact = await simulatePriceImpact(amountIn as bigint, path as string[]);
      }
    }

    // filter by price impact range
    if (MIN_PRICE_IMPACT_PERCENT > 0 || MAX_PRICE_IMPACT_PERCENT < 100) {
      if (impact === null || impact < MIN_PRICE_IMPACT_PERCENT || impact > MAX_PRICE_IMPACT_PERCENT) {
        filteredCount++;
        return;
      }
    }

    // if backrun criteria met, submit an optimized transaction
    if (BACKRUN_ENABLED && wallet && impact !== null && impact >= BACKRUN_IMPACT_THRESHOLD) {
      if (decodedTx && decodedTx.args) {
        const amountIn: bigint | undefined = decodedTx.args.amountIn || decodedTx.args.amountInMaximum;
        const amountOutMin: bigint = (decodedTx.args.amountOutMin || decodedTx.args.amountOutMinimum || BigInt(0)) as bigint;
        const path: string[] | undefined = decodedTx.args.path;
        if (amountIn && path && path.length >= 2) {
          attemptBackrun(txHash, tx.to!, functionSelector, path, amountIn, amountOutMin, impact);
        }
      }
    }

    // Extract amountIn and path for database storage
    let amountIn: bigint = BigInt(0);
    let tokenA = "0x0000000000000000000000000000000000000000";
    let tokenB = "0x0000000000000000000000000000000000000000";
    if (decodedTx && decodedTx.args) {
      const ai: bigint | undefined = decodedTx.args.amountIn || decodedTx.args.amountInMaximum || decodedTx.args.amountInMax;
      if (ai !== undefined) amountIn = ai as bigint;
      const path: string[] | undefined = decodedTx.args.path;
      if (path && path.length >= 2) {
        tokenA = path[0];
        tokenB = path[path.length - 1];
      }
    }

    // Save to database
    try {
      database.insertSwap({
        txHash,
        blockNumber: null,
        dexName,
        functionName: funcName,
        fromAddress: tx.from || "",
        toAddress: tx.to || "",
        tokenA,
        tokenB,
        amountIn: amountIn.toString(),
        predictedImpact: impact,
        gasPrice: tx.gasPrice?.toString() || "",
        gasLimit: tx.gasLimit.toString(),
        detectedAt: Date.now(),
        confirmedAt: null,
        actualAmountOut: null,
        actualImpact: null,
        actualPnL: null,
      });
    } catch (dbError: any) {
      console.warn(`⚠️  Failed to save swap to database: ${dbError.message}`);
    }

    console.log(`
🔔 DEX SWAP DETECTED #${swapCount}
   DEX:       ${dexName}
   Function:  ${funcName}
   Hash:      ${txHash}
   From:      ${formatAddress(tx.from || "")}
   To:        ${formatAddress(tx.to!)}
   Value:     ${formatValue(tx.value)}
   Gas Price: ${formatGasPrice(tx.gasPrice)}
   Gas Limit: ${tx.gasLimit.toString()}
   Nonce:     ${tx.nonce}
   Token A:   ${tokenA.slice(0, 6)}...${tokenA.slice(-4)}
   Token B:   ${tokenB.slice(0, 6)}...${tokenB.slice(-4)}` + (impact !== null ? `
   Impact:    ${impact.toFixed(4)}%` : ``) + `
────────────────────────────────────────────────────────────`);
  } catch (error: any) {
    const msg = error?.message || "";
    if (error?.code === 429 || msg.includes("exceeded")) {
      console.warn(`⚠️  Received 429 from provider, entering cooldown`);
      cooldownUntil = Date.now() + 1000;
    }
    if (error instanceof Error) {
      console.warn(`⚠️  Error processing tx ${txHash}: ${error.message}`);
    }
  } finally {
    activeRequests--;
  }
}

// set up a provider and attach listeners
function setupProvider(url: string) {
  reconnectBackoff = 1000;
  
  // Create WebSocket provider with timeout
  wsProvider = new ethers.WebSocketProvider(url);
  
  // Set up connection timeout
  const connectionTimeout = setTimeout(() => {
    console.error(`\n⏱️ WebSocket connection timeout after ${WS_CONNECTION_TIMEOUT}ms`);
    wsProvider.destroy();
    scheduleReconnect();
  }, WS_CONNECTION_TIMEOUT);
  
  // Attach pending transaction listener
  wsProvider.on("pending", (txHash: string) => {
    handlePending(txHash).catch((err) => {
      console.warn(`⚠️  Error in pending handler: ${err.message}`);
    });
  });
  
  // Attach error listener
  wsProvider.on("error", (err: Error) => {
    console.error(`\n❌ WebSocket error: ${err.message}`);
  });
  
  // Attach close listener on underlying socket
  (wsProvider as any).websocket.on("close", (code: number) => {
    console.warn(`\n🔌 WebSocket closed (${code}) - scheduling reconnect`);
    clearTimeout(connectionTimeout);
    scheduleReconnect();
  });
  
  // Clear timeout once connected
  wsProvider.getNetwork().then(() => {
    clearTimeout(connectionTimeout);
  }).catch(() => {
    // Connection will be handled by error/close events
  });
}

function scheduleReconnect() {
  connectionAttempts++;
  
  // Check if we've exceeded max retries
  if (connectionAttempts > WS_MAX_RETRIES) {
    if (FALLBACK_TO_HTTP) {
      console.warn(`⚠️  Max WebSocket retries (${WS_MAX_RETRIES}) exceeded. Switching to HTTP polling fallback...`);
      startHttpPollingFallback();
      return;
    } else {
      console.error(`❌ Max WebSocket retries (${WS_MAX_RETRIES}) exceeded. Giving up.`);
      console.error("💡 Set FALLBACK_TO_HTTP=true to enable HTTP polling fallback");
      process.exit(1);
    }
  }
  
  setTimeout(() => {
    reconnectBackoff = Math.min(WS_RETRY_BACKOFF_MAX, reconnectBackoff * 2);
    console.log(`🔄 Connection attempt ${connectionAttempts}/${WS_MAX_RETRIES} - reconnecting in ${reconnectBackoff}ms...`);
    setupProvider(wsUrl);
  }, reconnectBackoff);
}

/**
 * HTTP Polling Fallback - Used when WebSocket fails
 * Polls for pending transactions at regular intervals
 */
function startHttpPollingFallback() {
  if (isUsingFallback) return;
  
  isUsingFallback = true;
  console.log(`
╔════════════════════════════════════════════════════════════╗
║           MEV Listener - HTTP Polling Mode                 ║
║                                                              ║
║  ⚠️  WebSocket unavailable - using HTTP polling fallback    ║
╚════════════════════════════════════════════════════════════╝
  `);
  
  // Create HTTP provider
  httpProvider = new ethers.JsonRpcProvider(httpUrl);
  
  let lastBlockNumber = 0;
  
  // Poll for pending transactions
  const poll = async () => {
    try {
      const currentBlock = await httpProvider.getBlockNumber();
      
      // If new block, check for transactions in the block
      if (currentBlock > lastBlockNumber) {
        const newBlock = await httpProvider.getBlock(currentBlock, true);
        if (newBlock && newBlock.transactions) {
          for (const txHash of newBlock.transactions) {
            if (typeof txHash === 'string') {
              await handlePendingHttp(txHash);
            }
          }
        }
        lastBlockNumber = currentBlock;
      }
    } catch (error: any) {
      console.warn(`⚠️  HTTP polling error: ${error.message}`);
    }
  };
  
  // Start polling
  httpPollInterval = setInterval(poll, HTTP_POLL_INTERVAL);
  console.log(`📡 HTTP polling started (interval: ${HTTP_POLL_INTERVAL}ms)`);
  console.log(`📍 Monitoring DEX routers:`);
  Object.entries(DEX_ROUTERS).forEach(([name, addr]) => {
    console.log(`   - ${name}: ${addr}`);
  });
  console.log(`\n🔍 Listening for SWAP function calls...\n`);
}

/**
 * Handle pending transaction via HTTP (fallback mode)
 */
async function handlePendingHttp(txHash: string) {
  // Skip if we've already processed this tx
  if (seenTxs.has(txHash)) return;
  seenTxs.set(txHash, Date.now());

  // global cooldown due to previous 429
  if (Date.now() < cooldownUntil) {
    filteredCount++;
    return;
  }

  // respect concurrency limit
  if (activeRequests >= MAX_ACTIVE_REQUESTS) {
    filteredCount++;
    return;
  }
  activeRequests++;
  
  try {
    // Get transaction details
    const tx = await httpProvider.getTransaction(txHash);
    if (!tx) return;

    // FILTER 1: Check if recipient is a known DEX router
    if (!tx.to) {
      filteredCount++;
      return;
    }

    const toAddr = tx.to.toLowerCase();
    const isKnownDex = Object.values(DEX_ROUTERS).some(addr => addr === toAddr);
    if (!isKnownDex) {
      filteredCount++;
      return;
    }

    // FILTER 2: Check if function is a swap function
    if (!tx.data || tx.data.length < 10) {
      filteredCount++;
      return;
    }

    const functionSelector = tx.data.substring(0, 10);
    const isSwapFunction = Object.values(SWAP_FUNCTIONS).includes(functionSelector as any);
    if (!isSwapFunction) {
      filteredCount++;
      return;
    }

    // Decode transaction
    let funcNameOverride: string | undefined;
    let decodedTx: ethers.TransactionDescription | null = null;
    const abiList = ABI_BY_SELECTOR[functionSelector];
    if (abiList && abiList.length > 0) {
      try {
        const iface = new ethers.Interface(abiList);
        decodedTx = iface.parseTransaction({ data: tx.data });
      } catch {
        decodedTx = null;
      }
    }

    if (decodedTx && decodedTx.name) {
      funcNameOverride = decodedTx.name;
    }

    swapCount++;
    const dexName = getDexName(tx.to!);
    let funcName = getFunctionName(functionSelector);
    if (funcNameOverride) funcName = funcNameOverride;

    // Extract amountIn and path
    let amountIn: bigint = BigInt(0);
    let tokenA = "0x0000000000000000000000000000000000000000";
    let tokenB = "0x0000000000000000000000000000000000000000";
    if (decodedTx && decodedTx.args) {
      const ai: bigint | undefined = decodedTx.args.amountIn || decodedTx.args.amountInMaximum || decodedTx.args.amountInMax;
      if (ai !== undefined) amountIn = ai as bigint;
      const path: string[] | undefined = decodedTx.args.path;
      if (path && path.length >= 2) {
        tokenA = path[0];
        tokenB = path[path.length - 1];
      }
    }

    // Save to database
    try {
      database.insertSwap({
        txHash,
        blockNumber: null,
        dexName,
        functionName: funcName,
        fromAddress: tx.from || "",
        toAddress: tx.to || "",
        tokenA,
        tokenB,
        amountIn: amountIn.toString(),
        predictedImpact: null,
        gasPrice: tx.gasPrice?.toString() || "",
        gasLimit: tx.gasLimit.toString(),
        detectedAt: Date.now(),
        confirmedAt: null,
        actualAmountOut: null,
        actualImpact: null,
        actualPnL: null,
      });
    } catch (dbError: any) {
      console.warn(`⚠️  Failed to save swap to database: ${dbError.message}`);
    }

    console.log(`
🔔 DEX SWAP DETECTED #${swapCount} [HTTP]
   DEX:       ${dexName}
   Function:  ${funcName}
   Hash:      ${txHash}
   From:      ${formatAddress(tx.from || "")}
   To:        ${formatAddress(tx.to!)}
   Value:     ${formatValue(tx.value)}
   Gas Price: ${formatGasPrice(tx.gasPrice)}
   Token A:   ${tokenA.slice(0, 6)}...${tokenA.slice(-4)}
   Token B:   ${tokenB.slice(0, 6)}...${tokenB.slice(-4)}
────────────────────────────────────────────────────────────`);
  } catch (error: any) {
    const msg = error?.message || "";
    if (error?.code === 429 || msg.includes("exceeded")) {
      console.warn(`⚠️  Received 429 from provider, entering cooldown`);
      cooldownUntil = Date.now() + 1000;
    }
    if (error instanceof Error) {
      console.warn(`⚠️  Error processing tx ${txHash}: ${error.message}`);
    }
  } finally {
    activeRequests--;
  }
}

/**
 * Main mempool listener function
 */
async function main() {
  // Import and run validation
  const { validateConfig } = await import("./validate.ts");
  const config = validateConfig();
  
  // Set config values
  wsUrl = config.wsUrl;
  httpUrl = config.httpUrl;
  BACKRUN_ENABLED = config.backrunEnabled;
  BACKRUN_IMPACT_THRESHOLD = config.backrunImpactThreshold;
  
  // Initialize monitoring and recovery if enabled
  if (process.env.MONITORING_ENABLED === "yes") {
    try {
      const { monitoring, healthCheck } = await import("./monitoring.ts");
      healthCheck.start();
      console.log("🏁 Monitoring enabled");

      const { CircuitBreaker } = await import("./error-recovery.ts");
      (globalThis as any).botCircuitBreaker = new CircuitBreaker();
      console.log("🔒 Circuit breaker initialized");
    } catch (err: any) {
      console.warn("⚠️ Failed to initialize monitoring/recovery:", err.message || err);
    }
  }

  // Initialize wallet if backrun is enabled
  if (BACKRUN_ENABLED && config.privateKey) {
    const { getHttpProvider } = await import("./provider.ts");
    const httpProvider = getHttpProvider();
    wallet = new ethers.Wallet(config.privateKey, httpProvider);
    console.log("🔑 Backrun wallet initialized:", wallet.address);
  }
  
  console.log(`
╔════════════════════════════════════════════════════════════╗
║           MEV Listener - DEX Swap Monitor                   ║
║           Network: Polygon (WebSocket)                      ║
║                                                              ║
║  ✅ No signing    ✅ No gas    ✅ No risk                   ║
╚════════════════════════════════════════════════════════════╝
  `);

  console.log(`⏱️  Connection timeout: ${WS_CONNECTION_TIMEOUT}ms`);

  // Initialize database
  console.log("🗄️  Initializing database...");
  await database.initializeDatabase();
  console.log("✅ Database ready");

  // initialize provider and subscriptions
  setupProvider(wsUrl);

  // Get network info
  const networkInfo = await wsProvider.getNetwork();

  console.log(`✅ Connected to Polygon (Chain ID: ${networkInfo.chainId})`);
  console.log(`📡 WebSocket source: ${wsUrl.includes("alchemy.com") ? "Alchemy" : wsUrl}`);
  console.log(`📍 Monitoring DEX routers:`);
  Object.entries(DEX_ROUTERS).forEach(([name, addr]) => {
    console.log(`   - ${name}: ${addr}`);
  });
  console.log(`\n🔍 Listening for SWAP function calls...`);
  console.log("─".repeat(60));

  // Initialize confirmation monitor
  await confirmationMonitor.initializeConfirmationMonitor();
  console.log("🔍 Confirmation monitor started\n");


// periodically prune seenTxs map to avoid unbounded memory growth
// Run pruning every 1 minute regardless of TTL setting
setInterval(() => {
  const cutoff = Date.now() - SEEN_TX_TTL_MS;
  let pruned = 0;
  for (const [hash, ts] of seenTxs) {
    if (ts < cutoff) {
      seenTxs.delete(hash);
      pruned++;
    }
  }
  if (pruned > 0) {
    console.log(`🧹 Pruned ${pruned} expired transactions from cache (${seenTxs.size} remaining)`);
  }
}, 60000); // Check every minute



  // Keep the process running
  console.log("\n💡 Press Ctrl+C to stop listening\n");
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n\n🛑 Shutting down MEV Listener...");
  
  // Stop confirmation monitor
  await confirmationMonitor.stopConfirmationMonitor();
  
  // Stop HTTP polling if active
  if (httpPollInterval) {
    clearInterval(httpPollInterval);
    httpPollInterval = null;
  }
  
  // Generate final statistics
  const stats = database.getStats();
  console.log(`📊 Final Statistics:`);
  console.log(`   - Total swaps detected: ${swapCount}`);
  console.log(`   - Total swaps confirmed: ${stats.confirmed}`);
  console.log(`   - Total PnL generated: ${stats.totalPnL || 0} MATIC`);
  console.log(`   - Average PnL per swap: ${stats.avgPnL ? (stats.avgPnL as number).toFixed(4) : 0} MATIC`);
  console.log(`   - Transactions in cache: ${seenTxs.size}`);
  console.log(`   - Transactions filtered: ${filteredCount}`);
  
  // Clean up provider
  if (wsProvider) {
    wsProvider.removeAllListeners();
    wsProvider.destroy();
  }
  
  // Close database
  database.closeDatabase();
  
  process.exit(0);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

main().catch((error) => {
  console.error("Failed to start mempool listener:", error);
  process.exit(1);
});
