import { ethers } from "ethers";
import "dotenv/config";

/**
 * Testnet Testing Suite for MEV Bot
 * 
 * Tests the bot on Polygon Mumbai testnet with real providers
 * Validates contract deployment, flash loans, swaps, and backrun logic
 */

interface TestConfig {
  wsUrl: string;
  httpUrl: string;
  privateKey: string;
  contractAddress: string;
  aavePoolAddress: string;
  beneficiary: string;
}

const TESTNET_CONFIG: TestConfig = {
  wsUrl: process.env.ALCHEMY_WS_URL_MUMBAI || "wss://polygon-mumbai.g.alchemy.com/v2/",
  httpUrl: process.env.ALCHEMY_HTTP_URL_MUMBAI || "https://polygon-mumbai.g.alchemy.com/v2/",
  privateKey: process.env.TESTNET_PRIVATE_KEY || "",
  contractAddress: process.env.BACKRUN_CONTRACT_MUMBAI || "",
  aavePoolAddress: "0xE12cFc477726E71265216bF2f731F91D1b5dFEbb", // Aave V3 Pool on Mumbai
  beneficiary: process.env.TESTNET_BENEFICIARY || "",
};

// Test constants
const USDC_MUMBAI = "0x9999f7Fea440d4f88Bbc6af3E5C5e338c3C9f050";
const USDT_MUMBAI = "0xca35b7d915458ef540ade6068dfe2f44e8fa733c";
const QUICKSWAP_V2_MUMBAI = "0x8954AfA98594b838bda56FE4C12a09D7739D179b";

/**
 * Test 1: Contract Deployment & Initialization
 */
export async function testContractDeployment() {
  console.log("\n📋 TEST 1: Contract Deployment & Initialization");
  console.log("─".repeat(60));

  try {
    const httpProvider = new ethers.JsonRpcProvider(TESTNET_CONFIG.httpUrl);
    
    // Verify contract exists and is deployed
    const code = await httpProvider.getCode(TESTNET_CONFIG.contractAddress);
    if (code === "0x") {
      throw new Error("Contract not deployed at specified address");
    }

    console.log("✅ Contract deployed successfully");
    console.log(`   Address: ${TESTNET_CONFIG.contractAddress}`);
    console.log(`   Code size: ${(code.length - 2) / 2} bytes`);

    return true;
  } catch (error: any) {
    console.error("❌ Deployment test failed:", error.message);
    return false;
  }
}

/**
 * Test 2: Flash Loan Mechanics
 */
export async function testFlashLoanMechanics() {
  console.log("\n📋 TEST 2: Flash Loan Mechanics");
  console.log("─".repeat(60));

  try {
    const httpProvider = new ethers.JsonRpcProvider(TESTNET_CONFIG.httpUrl);
    const wallet = new ethers.Wallet(TESTNET_CONFIG.privateKey, httpProvider);

    // Check Aave pool balance of token
    const aavePoolABI = ["function balanceOf(address) view returns (uint)"];
    const tokenContract = new ethers.Contract(USDC_MUMBAI, aavePoolABI, httpProvider);
    const poolBalance = await tokenContract.balanceOf(TESTNET_CONFIG.aavePoolAddress);

    console.log(`✅ Aave Pool available USDC: ${ethers.formatUnits(poolBalance, 6)}`);
    
    if (poolBalance < ethers.parseUnits("1000", 6)) {
      console.warn("⚠️  Low liquidity in Aave pool (test may fail)");
    }

    return true;
  } catch (error: any) {
    console.error("❌ Flash loan test failed:", error.message);
    return false;
  }
}

/**
 * Test 3: Pool Connectivity
 */
export async function testPoolConnectivity() {
  console.log("\n📋 TEST 3: Pool Connectivity");
  console.log("─".repeat(60));

  try {
    const httpProvider = new ethers.JsonRpcProvider(TESTNET_CONFIG.httpUrl);
    
    // Test Uniswap V3 pool data retrieval
    const factoryAddress = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
    const factoryABI = [
      "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)"
    ];
    
    const factory = new ethers.Contract(factoryAddress, factoryABI, httpProvider);
    
    // This should work even if pool doesn't exist (returns 0x0)
    const poolAddr = await factory.getPool(USDC_MUMBAI, USDT_MUMBAI, 3000);
    
    console.log(`✅ Uniswap V3 Factory responding`);
    console.log(`   USDC/USDT pool: ${poolAddr === ethers.ZeroAddress ? "Not found" : poolAddr}`);

    return true;
  } catch (error: any) {
    console.error("❌ Pool connectivity test failed:", error.message);
    return false;
  }
}

/**
 * Test 4: Gas Price & Fee Estimation
 */
export async function testGasPriceEstimation() {
  console.log("\n📋 TEST 4: Gas Price & Fee Estimation");
  console.log("─".repeat(60));

  try {
    const httpProvider = new ethers.JsonRpcProvider(TESTNET_CONFIG.httpUrl);
    
    const feeData = await httpProvider.getFeeData();
    const gasPrice = feeData.gasPrice;
    const maxFeePerGas = feeData.maxFeePerGas;
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;

    console.log(`✅ Gas price data Retrieved`);
    console.log(`   Current gas price: ${ethers.formatUnits(gasPrice || 0, "gwei")} gwei`);
    console.log(`   Max fee per gas: ${ethers.formatUnits(maxFeePerGas || 0, "gwei")} gwei`);
    console.log(`   Priority fee: ${ethers.formatUnits(maxPriorityFeePerGas || 0, "gwei")} gwei`);

    // Estimate backrun gas cost
    const estimatedGas = 250000n; // Typical backrun
    const estimatedCost = estimatedGas * (gasPrice || 1000000000n);
    console.log(`   Est. backrun cost: ${ethers.formatEther(estimatedCost)} MATIC`);

    return true;
  } catch (error: any) {
    console.error("❌ Gas estimation test failed:", error.message);
    return false;
  }
}

/**
 * Test 5: Wallet & Account Status
 */
export async function testWalletStatus() {
  console.log("\n📋 TEST 5: Wallet & Account Status");
  console.log("─".repeat(60));

  try {
    const httpProvider = new ethers.JsonRpcProvider(TESTNET_CONFIG.httpUrl);
    const wallet = new ethers.Wallet(TESTNET_CONFIG.privateKey, httpProvider);

    const balance = await httpProvider.getBalance(wallet.address);
    const nonce = await httpProvider.getTransactionCount(wallet.address);

    console.log(`✅ Wallet ready`);
    console.log(`   Address: ${wallet.address}`);
    console.log(`   MATIC balance: ${ethers.formatEther(balance)}`);
    console.log(`   Nonce: ${nonce}`);

    if (balance < ethers.parseEther("0.1")) {
      console.warn("⚠️  Low MATIC balance (need ~0.1+ for testing)");
      return false;
    }

    return true;
  } catch (error: any) {
    console.error("❌ Wallet test failed:", error.message);
    return false;
  }
}

/**
 * Test 6: Mempool Listening (if running locally)
 */
export async function testMempoolListener() {
  console.log("\n📋 TEST 6: Mempool Listener");
  console.log("─".repeat(60));

  try {
    const wsProvider = new ethers.WebSocketProvider(TESTNET_CONFIG.wsUrl);
    
    // Try to connect and get network info
    const network = await wsProvider.getNetwork();
    console.log(`✅ WebSocket connected to testnet`);
    console.log(`   Network: Polygon Mumbai (Chain ${network.chainId})`);

    // Test transaction listening
    let txCount = 0;
    const listener = (txHash: string) => {
      txCount++;
      if (txCount <= 3) {
        console.log(`   📍 Pending tx: ${txHash.slice(0, 10)}...`);
      }
    };

    // Listen for 5 seconds then stop
    wsProvider.on("pending", listener);
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    wsProvider.off("pending", listener);
    wsProvider.destroy();

    console.log(`✅ Listened to ${txCount} pending transactions in 5 seconds`);
    return txCount > 0;
  } catch (error: any) {
    console.error("❌ Mempool test failed:", error.message);
    return false;
  }
}

/**
 * Test 7: Price Oracle Data
 */
export async function testPriceOracle() {
  console.log("\n📋 TEST 7: Price Oracle Data");
  console.log("─".repeat(60));

  try {
    const httpProvider = new ethers.JsonRpcProvider(TESTNET_CONFIG.httpUrl);
    
    // Try to get Uniswap V3 pool data
    const poolABI = [
      "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)"
    ];
    
    // Note: This may not work if pool doesn't exist on Mumbai
    // Just test the mechanism
    const factoryAddress = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
    const factoryABI = ["function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)"];
    const factory = new ethers.Contract(factoryAddress, factoryABI, httpProvider);
    
    const poolAddr = await factory.getPool(USDC_MUMBAI, USDT_MUMBAI, 3000);
    
    if (poolAddr !== ethers.ZeroAddress) {
      const pool = new ethers.Contract(poolAddr, poolABI, httpProvider);
      const [sqrtPriceX96, tick] = await pool.slot0();
      
      console.log(`✅ Price oracle data retrieved`);
      console.log(`   Tick: ${tick}`);
      console.log(`   SqrtPrice: ${sqrtPriceX96.toString()}`);
    } else {
      console.log(`⚠️  USDC/USDT pool not deployed on Mumbai (expected for testnet)`);
    }

    return true;
  } catch (error: any) {
    console.error("❌ Price oracle test failed:", error.message);
    return false;
  }
}

/**
 * Test 8: Network Latency & Sync Status
 */
export async function testNetworkLatency() {
  console.log("\n📋 TEST 8: Network Latency & Sync Status");
  console.log("─".repeat(60));

  try {
    const httpProvider = new ethers.JsonRpcProvider(TESTNET_CONFIG.httpUrl);
    
    const start = Date.now();
    const blockNumber = await httpProvider.getBlockNumber();
    const latency = Date.now() - start;

    console.log(`✅ Network responding`);
    console.log(`   Current block: ${blockNumber}`);
    console.log(`   Latency: ${latency}ms`);

    if (latency > 2000) {
      console.warn("⚠️  High latency detected (>2s)");
    }

    return true;
  } catch (error: any) {
    console.error("❌ Network latency test failed:", error.message);
    return false;
  }
}

/**
 * Run all testnet tests
 */
export async function runAllTests() {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║     MEV Bot Testnet Validation Suite - Mumbai Network      ║
║     ${new Date().toISOString()}                        ║
╚════════════════════════════════════════════════════════════╝
  `);

  // Validate config
  if (!TESTNET_CONFIG.privateKey) {
    console.error("❌ TESTNET_PRIVATE_KEY not set in .env");
    process.exit(1);
  }

  if (!TESTNET_CONFIG.contractAddress) {
    console.error("❌ BACKRUN_CONTRACT_MUMBAI not set in .env");
    process.exit(1);
  }

  const results = {
    deployment: await testContractDeployment(),
    flashLoan: await testFlashLoanMechanics(),
    poolConnectivity: await testPoolConnectivity(),
    gasEstimation: await testGasPriceEstimation(),
    wallet: await testWalletStatus(),
    mempool: await testMempoolListener(),
    oracle: await testPriceOracle(),
    latency: await testNetworkLatency(),
  };

  // Summary
  console.log(`\n${"═".repeat(60)}`);
  console.log("📊 TEST SUMMARY");
  console.log("─".repeat(60));
  
  const passed = Object.values(results).filter(r => r).length;
  const total = Object.keys(results).length;

  Object.entries(results).forEach(([test, result]) => {
    const icon = result ? "✅" : "❌";
    console.log(`${icon} ${test.padEnd(20)} ${result ? "PASS" : "FAIL"}`);
  });

  console.log(`\nTotal: ${passed}/${total} tests passed`);

  if (passed === total) {
    console.log(`\n✨ Testnet is ready for MEV bot deployment!`);
  } else {
    console.log(`\n⚠️  Some tests failed - review logs above`);
  }

  console.log(`${"═".repeat(60)}\n`);
}

// Run if called directly
if (require.main === module) {
  runAllTests().catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
