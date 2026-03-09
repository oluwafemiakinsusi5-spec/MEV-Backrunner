/**
 * Deploy BackrunExecutor contract
 * Run: npx hardhat run scripts/deploy-backrun.ts --network polygon
 */

import { ethers } from "ethers";
import { loadSecret } from "./secrets-loader.ts";

async function main() {
  console.log("🚀 Deploying BackrunExecutor contract...");

  // Aave V3 address provider on Polygon
  const AAVE_PROVIDER = "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb";

  // Try to use Hardhat runtime if available (preferred when running via npx hardhat run)
  let deployedAddress: string | null = null;

  try {
    const hreModule = await import("hardhat");
    const hre = (hreModule as any).default || hreModule;

    if (hre && hre.ethers && typeof hre.ethers.getContractFactory === "function") {
      // Safety: prevent accidental mainnet deploys without explicit confirmation
      try {
        const netName = hre.network?.name;
        if (netName === "polygon" && process.env.CONFIRM_MAINNET !== "yes") {
          throw new Error(
            "CONFIRM_MAINNET not set to 'yes' — set CONFIRM_MAINNET=yes in .env to allow mainnet deploy"
          );
        }
      } catch (guardErr) {
        throw guardErr;
      }
      const signer = (await hre.ethers.getSigners())[0];

      // ensure signer has funds on local fork/node
      try {
        const bal = await hre.ethers.provider.getBalance(signer.address);
        if ((bal as any) === 0n) {
          const topUp = ethers.parseEther("1000").toString(16);
          // Try different methods to fund the account
          try {
            // Method 1: Use hardhat_setBalance (works with legacy provider)
            await hre.network.provider.send("hardhat_setBalance", [
              signer.address,
              "0x" + topUp,
            ]);
            console.log(`💸 funded signer ${signer.address} with 1000 ETH via hardhat_setBalance`);
          } catch {
            // Method 2: Use evm_setAccountBalance (for EDR provider)
            try {
              await hre.network.provider.request({
                method: "evm_setAccountBalance",
                params: [signer.address, "0x" + topUp],
              });
              console.log(`💸 funded signer ${signer.address} with 1000 ETH via evm_setAccountBalance`);
            } catch {
              // Method 3: Impersonate a rich account and transfer funds
              try {
                // Impersonate a known rich account on the fork
                const richAccount = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"; // Hardhat's first account
                await hre.network.provider.request({
                  method: "hardhat_impersonateAccount",
                  params: [richAccount],
                });
                const richSigner = await hre.ethers.getSigner(richAccount);
                await richSigner.sendTransaction({
                  to: signer.address,
                  value: ethers.parseEther("1000"),
                });
                await hre.network.provider.request({
                  method: "hardhat_stopImpersonatingAccount",
                  params: [richAccount],
                });
                console.log(`💸 funded signer ${signer.address} by transferring from rich account`);
              } catch (fundError) {
                console.log(`⚠️ Could not fund signer automatically.`);
              }
            }
          }
        }
      } catch {
        // ignore if not supported
      }

      const Factory = await hre.ethers.getContractFactory("BackrunExecutor", signer);
      // Constructor requires (provider, guardians[]) — at least 2 guardians
      const guardians = [signer.address, signer.address]; // Use deployer as both guardians
      const contract = await Factory.deploy(AAVE_PROVIDER, guardians);
      await contract.waitForDeployment();
      deployedAddress = await contract.getAddress();
      
      // Try to capture gas usage (ethers v6)
      try {
        const deployTx = contract.deploymentTransaction();
        if (deployTx) {
          const receipt = await deployTx.wait();
          if (receipt) {
            console.log(`⛽ deployment used ${receipt.gasUsed?.toString() || 'unknown'} gas (network=${hre.network?.name})`);
          }
        }
      } catch {
        // Gas logging is optional
      }
    }
  } catch (e) {
    // ignore - fallback to standalone ethers
  }

  if (!deployedAddress) {
    // Standalone fallback: use compiled artifact and ethers provider
    const artifactImport = await import(
      "../artifacts/contracts/BackrunExecutor.sol/BackrunExecutor.json",
      { assert: { type: "json" } }
    );
    const artifact: any = (artifactImport as any).default || artifactImport;

    const providerUrl = process.env.POLYGON_RPC_URL || process.env.ALCHEMY_HTTP_URL || "http://127.0.0.1:8545";
    const provider = new ethers.JsonRpcProvider(providerUrl);

    // Safety check for standalone mode: avoid accidental mainnet deploys
    if (
      (providerUrl.includes("polygon") || providerUrl.includes("alchemy")) &&
      process.env.CONFIRM_MAINNET !== "yes"
    ) {
      throw new Error(
        "CONFIRM_MAINNET not set to 'yes' — set CONFIRM_MAINNET=yes in .env to allow live polygon deploy"
      );
    }

    // Use explicit PRIVATE_KEY when provided; otherwise attempt to use an unlocked
    // account exposed by the JSON-RPC node (useful when running a local Hardhat node).
    let signer: any;
    const privateKey = loadSecret("PRIVATE_KEY");
    if (privateKey) {
      signer = new ethers.Wallet(privateKey, provider);
    } else {
      try {
        const accounts: string[] = await provider.send("eth_accounts", []);
        if (accounts && accounts.length > 0) {
          signer = provider.getSigner(accounts[0]);
          console.log(`🔑 Using unlocked provider account ${accounts[0]} as signer`);
        } else {
          throw new Error("No unlocked accounts returned from provider");
        }
      } catch (err) {
        throw new Error(
          "PRIVATE_KEY not set and no unlocked accounts available on provider; run via Hardhat or set PRIVATE_KEY"
        );
      }
    }

    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
    // Constructor requires (provider, guardians[]) — at least 2 guardians
    const guardians = [signer.address, signer.address]; // Use deployer as both guardians
    const contract = await factory.deploy(AAVE_PROVIDER, guardians);
    await contract.waitForDeployment();
    deployedAddress = await contract.getAddress();
    
    // Try to capture gas usage from deployment transaction (ethers v6)
    try {
      const deployTx = contract.deploymentTransaction();
      if (deployTx) {
        const receipt = await deployTx.wait();
        if (receipt) {
          console.log(`⛽ deployment used ${receipt.gasUsed?.toString() || 'unknown'} gas (standalone)`);
        }
      }
    } catch {
      // Gas logging is optional
    }
  }

  console.log(`✅ BackrunExecutor deployed to: ${deployedAddress}`);
  console.log(`\nUpdate your .env file with:`);
  console.log(`BACKRUN_CONTRACT=${deployedAddress}`);
  console.log(`\nVerify on Polygonscan:`);
  console.log(`https://polygonscan.com/address/${deployedAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
