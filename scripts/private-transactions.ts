import { ethers } from "ethers";
import "dotenv/config";

/**
 * Private Transaction Support
 * Sends transactions via private mempools to avoid front-running
 * Supports: MEV-blocker, Flashbots Relay, MEV-Protect
 */

export interface PrivateTxConfig {
  provider: string; // "flashbots" | "mev-blocker" | "mev-protect"
  relayUrl?: string;
  mev_share?: boolean; // Participate in MEV-share
  timeout?: number;
}

/**
 * MEV-Blocker (Privacy-focused)
 * Sends transactions to private mempool to prevent front-running
 */
export class MEVBlocker {
  private relayUrl = "https://api.mevblocker.io/relay";
  
  /**
   * Send private transaction via MEV-Blocker
   */
  async sendPrivateTransaction(
    signedTx: string
  ): Promise<{ txHash: string; relayUrl: string }> {
    try {
      console.log(`🔒 Sending transaction via MEV-Blocker...`);

      const response = await fetch(`${this.relayUrl}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signedTransaction: signedTx }),
      });

      if (!response.ok) {
        throw new Error(`MEV-Blocker error: ${response.statusText}`);
      }

      const data: any = await response.json();
      console.log(`✅ Transaction submitted to MEV-Blocker: ${data.txHash}`);

      return {
        txHash: data.txHash,
        relayUrl: this.relayUrl,
      };
    } catch (error: any) {
      console.error(`❌ MEV-Blocker failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get transaction status in private mempool
   */
  async getStatus(txHash: string): Promise<any> {
    try {
      const response = await fetch(`${this.relayUrl}/status/${txHash}`);
      
      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch {
      return null;
    }
  }
}

/**
 * Flashbots Relay (Maximum MEV protection)
 * Sends transactions to Flashbots relayer for bundle inclusion
 */
export class FlashbotsRelay {
  private relayUrl = "https://relay.flashbots.net";
  private authSigner: ethers.Wallet;

  constructor(privateKey: string) {
    this.authSigner = new ethers.Wallet(privateKey);
  }

  /**
   * Send transaction bundle to Flashbots
   * (Requires authentication signature)
   */
  async sendBundle(
    txs: string[],
    blockNumber: number,
    mevShare: boolean = false
  ): Promise<{ bundleHash: string; relayUrl: string }> {
    try {
      console.log(`📦 Sending ${txs.length} transactions to Flashbots...`);

      // Create bundle
      const bundle = {
        jsonrpc: "2.0",
        id: 1,
        method: mevShare ? "mev_sendMevShareBundle" : "eth_sendBundle",
        params: [
          {
            txs,
            blockTarget: blockNumber + 1,
            minTimestamp: Math.floor(Date.now() / 1000),
            maxTimestamp: Math.floor(Date.now() / 1000) + 300,
          },
        ],
      };

      // Sign bundle
      const signature = await this.authSigner.signMessage(
        ethers.toUtf8Bytes(JSON.stringify(bundle))
      );

      const response = await fetch(this.relayUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Flashbots-Signature": `${this.authSigner.address}:${signature}`,
        },
        body: JSON.stringify(bundle),
      });

      if (!response.ok) {
        throw new Error(`Flashbots error: ${response.statusText}`);
      }

      const data: any = await response.json();

      if (data.error) {
        throw new Error(data.error.message);
      }

      console.log(`✅ Bundle submitted to Flashbots: ${data.result.bundleHash}`);

      return {
        bundleHash: data.result.bundleHash,
        relayUrl: this.relayUrl,
      };
    } catch (error: any) {
      console.error(`❌ Flashbots failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check bundle status
   */
  async getBundleStatus(bundleHash: string): Promise<any> {
    try {
      const signature = await this.authSigner.signMessage(
        ethers.toUtf8Bytes(bundleHash)
      );

      const response = await fetch(`${this.relayUrl}/bundle/${bundleHash}`, {
        method: "GET",
        headers: {
          "X-Flashbots-Signature": `${this.authSigner.address}:${signature}`,
        },
      });

      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch {
      return null;
    }
  }
}

/**
 * MEV-Protect (Balance privacy and value)
 * Hybrid approach with MEV protection
 */
export class MEVProtect {
  private relayUrl = "https://mev.api.infura.io/mev/protect";

  /**
   * Send private transaction with MEV protection
   */
  async sendPrivateTransaction(
    signedTx: string,
    options?: { preferredRelays?: string[] }
  ): Promise<{ txHash: string }> {
    try {
      console.log(`🔐 Sending transaction via MEV-Protect...`);

      const response = await fetch(`${this.relayUrl}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signedTransaction: signedTx,
          preferredRelays: options?.preferredRelays,
        }),
      });

      if (!response.ok) {
        throw new Error(`MEV-Protect error: ${response.statusText}`);
      }

      const data: any = await response.json();
      console.log(`✅ Transaction submitted to MEV-Protect: ${data.txHash}`);

      return { txHash: data.txHash };
    } catch (error: any) {
      console.error(`❌ MEV-Protect failed: ${error.message}`);
      throw error;
    }
  }
}

/**
 * Private Transaction Manager - Route to best provider
 */
export class PrivateTransactionManager {
  private mevBlocker: MEVBlocker;
  private flashbots: FlashbotsRelay;
  private mevProtect: MEVProtect;
  private preferredProvider: string;

  constructor(
    privateKey: string,
    preferredProvider: string = "mev-blocker"
  ) {
    this.mevBlocker = new MEVBlocker();
    this.flashbots = new FlashbotsRelay(privateKey);
    this.mevProtect = new MEVProtect();
    this.preferredProvider = preferredProvider;
  }

  /**
   * Send private transaction with automatic fallback
   */
  async sendPrivateTransaction(
    signedTx: string,
    blockNumber?: number
  ): Promise<{ txHash: string; provider: string; relayUrl?: string }> {
    const providers = this.getProviderOrder();

    for (const provider of providers) {
      try {
        switch (provider) {
          case "mev-blocker":
            const mevBlockerResult = await this.mevBlocker.sendPrivateTransaction(
              signedTx
            );
            return {
              txHash: mevBlockerResult.txHash,
              provider: "mev-blocker",
              relayUrl: mevBlockerResult.relayUrl,
            };

          case "flashbots": {
            if (!blockNumber) {
              console.warn(
                "⚠️  BlockNumber required for Flashbots, trying next provider"
              );
              continue;
            }

            const flashbotsResult = await this.flashbots.sendBundle(
              [signedTx],
              blockNumber
            );
            return {
              txHash: flashbotsResult.bundleHash,
              provider: "flashbots",
              relayUrl: flashbotsResult.relayUrl,
            };
          }

          case "mev-protect":
            const mevProtectResult = await this.mevProtect.sendPrivateTransaction(
              signedTx
            );
            return {
              txHash: mevProtectResult.txHash,
              provider: "mev-protect",
            };
        }
      } catch (error: any) {
        console.warn(`⚠️  ${provider} failed: ${error.message}. Trying next...`);
        continue;
      }
    }

    throw new Error(
      `All private transaction providers failed. Falling back to public mempool.`
    );
  }

  /**
   * Get provider priority order
   */
  private getProviderOrder(): string[] {
    const order = [
      this.preferredProvider,
      "mev-blocker",
      "mev-protect",
      "flashbots",
    ];

    // Remove duplicates
    return [...new Set(order)];
  }

  /**
   * Send transaction via public mempool (fallback)
   */
  async sendPublicTransaction(
    provider: ethers.JsonRpcSigner,
    tx: ethers.TransactionRequest
  ): Promise<string> {
    console.log(`📢 Falling back to public mempool...`);

    const response = await provider.sendTransaction(tx);
    return response.hash;
  }
}

/**
 * Integration with backrun executor
 */
export async function executeBackrunWithPrivacy(
  wallet: ethers.Wallet,
  contractAddress: string,
  backrunParams: any,
  usePrivateTx: boolean = true,
  privateTxProvider: string = "mev-blocker"
): Promise<{ hash: string; private: boolean }> {
  try {
    // Build the transaction
    const contract = new ethers.Contract(
      contractAddress,
      [
        "function executeBackrun(address tokenToBorrow, uint256 amountToBorrow, address[] path, uint256 amountOutMin) external",
      ],
      wallet
    );

    const tx = await contract.executeBackrun.populateTransaction(
      backrunParams.tokenToBorrow,
      backrunParams.amountToBorrow,
      backrunParams.path,
      backrunParams.amountOutMin
    );

    const feeData = await wallet.provider!.getFeeData();
    tx.gasPrice = backrunParams.gasPrice || feeData.gasPrice;
    tx.gasLimit = backrunParams.gasLimit || 250000n;

    // Sign the transaction
    const signedTx = await wallet.signTransaction(tx as ethers.TransactionRequest);

    if (usePrivateTx) {
      const manager = new PrivateTransactionManager(wallet.privateKey, privateTxProvider);
      const blockNumber = await wallet.provider!.getBlockNumber();

      try {
        const result = await manager.sendPrivateTransaction(signedTx, blockNumber);
        console.log(`✅ Backrun sent via ${result.provider}`);
        return {
          hash: result.txHash,
          private: true,
        };
      } catch (error: any) {
        console.warn(`⚠️  Private transaction failed: ${error.message}`);
        console.log(`Falling back to public mempool...`);

        // Fallback to public mempool
        const response = await wallet.provider!.broadcastTransaction(signedTx);
        return {
          hash: response.hash,
          private: false,
        };
      }
    } else {
      // Send via public mempool
      const response = await wallet.provider!.broadcastTransaction(signedTx);
      return {
        hash: response.hash,
        private: false,
      };
    }
  } catch (error: any) {
    console.error(`❌ Backrun execution failed: ${error.message}`);
    throw error;
  }
}

/**
 * Privacy recommendation engine
 */
export function recommendPrivacyProvider(scenario: {
  toxicity: "low" | "medium" | "high";
  profitAmount: bigint;
  gasPrice: bigint;
}): string {
  if (scenario.toxicity === "high") {
    console.log(`🔴 High toxicity detected - recommending Flashbots`);
    return "flashbots";
  } else if (scenario.toxicity === "medium") {
    console.log(`🟡 Medium toxicity detected - recommending MEV-Blocker`);
    return "mev-blocker";
  } else {
    console.log(`🟢 Low toxicity - MEV-Protect acceptable`);
    return "mev-protect";
  }
}

// Classes exported inline above; no additional export needed
