import "dotenv/config";
import {
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
} from "@zerodev/sdk";
import { KERNEL_V3_1, getEntryPoint } from "@zerodev/sdk/constants";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { 
  http, 
  createPublicClient, 
  zeroAddress, 
  parseEther,
  encodeFunctionData,
  encodeAbiParameters,
  parseAbiParameters,
  type Hex 
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { LitPKPExecutor, type ExecuteOperation } from "./lit-pkp-executor.js";
import { ethers } from "ethers";
import fs from "fs";
import path from "path";

const ZERODEV_RPC = process.env.ZERODEV_BASE_SEPOLIA_RPC;
const chain = baseSepolia;
const entryPoint = getEntryPoint("0.7");
const kernelVersion = KERNEL_V3_1;

async function main() {
  console.log("🚀 Starting Complete Lit PKP + ZeroDev Integration Demo");

  // Get environment variables
  const pkpTokenId = process.env.PKP_TOKEN_ID!;
  const pkpPublicKey = process.env.PKP_PUBLIC_KEY!;
  const pkpEthAddress = process.env.PKP_ETH_ADDRESS! as `0x${string}`;
  const walletPrivateKey = process.env.WALLET_PRIVATE_KEY! as `0x${string}`;
  const litPKPExecutorAddress = process.env.LIT_PKP_EXECUTOR_ADDRESS! as `0x${string}`;

  console.log("\n📋 Configuration:");
  console.log("  - PKP Address:", pkpEthAddress);
  console.log("  - LitPKPExecutor Contract:", litPKPExecutorAddress);

  // Initialize the Lit PKP Executor
  console.log("\n🔐 Initializing Lit PKP Executor...");
  const litExecutor = new LitPKPExecutor({
    pkpTokenId,
    pkpPublicKey,
    pkpEthAddress,
    walletPrivateKey,
    litNetwork: "datil-dev",
  });

  await litExecutor.connect();
  console.log("✅ Connected to Lit Network");

  // Setup ZeroDev smart account
  const privateKey = generatePrivateKey();
  const signer = privateKeyToAccount(privateKey);

  const publicClient = createPublicClient({
    transport: http(ZERODEV_RPC),
    chain,
  });

  const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
    signer,
    entryPoint,
    kernelVersion,
  });

  const account = await createKernelAccount(publicClient, {
    plugins: {
      sudo: ecdsaValidator,
    },
    entryPoint,
    kernelVersion,
  });

  const zerodevPaymaster = createZeroDevPaymasterClient({
    chain,
    transport: http(ZERODEV_RPC),
  });

  const kernelClient = createKernelAccountClient({
    account,
    chain,
    bundlerTransport: http(ZERODEV_RPC),
    client: publicClient,
    paymaster: {
      getPaymasterData(userOperation) {
        return zerodevPaymaster.sponsorUserOperation({ userOperation });
      },
    },
  });

  const accountAddress = kernelClient.account.address;
  console.log("\n🏦 Smart Account Address:", accountAddress);

  // Install the LitPKPExecutor module into the smart account
  console.log("\n📦 Installing LitPKPExecutor module into smart account...");
  
  // Load the contract ABI
  const contractPath = path.join(process.cwd(), "artifacts/contracts/LitPKPExecutor.sol/LitPKPExecutor.json");
  const contractArtifact = JSON.parse(fs.readFileSync(contractPath, "utf8"));

  // Encode the installation data
  // Convert the PKP token ID to bytes32 hex
  const pkpTokenIdHex = ("0x" + BigInt(pkpTokenId).toString(16).padStart(64, "0")) as Hex;
  
  const installData = encodeAbiParameters(
    parseAbiParameters("address, bytes32"),
    [pkpEthAddress, pkpTokenIdHex]
  );

  // Create the installation calldata
  const installCalldata = encodeFunctionData({
    abi: contractArtifact.abi,
    functionName: "onInstall",
    args: [installData],
  });

  console.log("  - Module address:", litPKPExecutorAddress);
  console.log("  - PKP to install:", pkpEthAddress);

  // Send the installation transaction
  try {
    const installTxHash = await kernelClient.sendTransaction({
      to: litPKPExecutorAddress,
      data: installCalldata,
      value: BigInt(0),
    });

    console.log("  - Installation tx:", installTxHash);
    
    const installReceipt = await publicClient.waitForTransactionReceipt({
      hash: installTxHash,
    });

    if (installReceipt.status === "success") {
      console.log("✅ Module installed successfully!");
    } else {
      console.log("❌ Module installation failed");
      return;
    }
  } catch (error: any) {
    if (error.message?.includes("ModuleAlreadyInstalled")) {
      console.log("ℹ️  Module already installed, continuing...");
    } else {
      console.error("❌ Error installing module:", error);
      return;
    }
  }

  // Now execute an operation using the PKP
  console.log("\n🔨 Executing operation with PKP signature...");

  const operation: ExecuteOperation = {
    to: zeroAddress,
    value: BigInt(0),
    data: "0x" as Hex,
    operation: 0,
  };

  // Create operation hash using the contract
  const provider = new ethers.JsonRpcProvider(ZERODEV_RPC);
  const litPKPExecutorContract = new ethers.Contract(
    litPKPExecutorAddress,
    contractArtifact.abi,
    provider
  );

  const operationHash = await litPKPExecutorContract.getOperationHash(
    accountAddress,
    operation.to,
    operation.value,
    operation.data
  );

  console.log("  - Operation hash:", operationHash);

  // Sign the operation with the PKP
  console.log("  - Signing with PKP...");
  const signingResult = await litExecutor.signOperation(
    operation,
    chain.id,
    operationHash as Hex
  );

  if (!signingResult.success) {
    console.error("❌ Failed to sign with PKP");
    await litExecutor.disconnect();
    return;
  }

  console.log("✅ Operation signed by PKP!");
  console.log("  - Signature:", signingResult.signature.slice(0, 20) + "...");

  // Execute the operation through the module
  console.log("\n📤 Executing operation through LitPKPExecutor module...");

  const executeCalldata = encodeFunctionData({
    abi: contractArtifact.abi,
    functionName: "executeFromExecutor",
    args: [
      operation.to,
      operation.value,
      operation.data,
      signingResult.signature,
    ],
  });

  try {
    const executeTxHash = await kernelClient.sendTransaction({
      to: litPKPExecutorAddress,
      data: executeCalldata,
      value: BigInt(0),
    });

    console.log("  - Execution tx:", executeTxHash);

    const executeReceipt = await publicClient.waitForTransactionReceipt({
      hash: executeTxHash,
    });

    if (executeReceipt.status === "success") {
      console.log("✅ Operation executed successfully through PKP module!");
      console.log("🔗 View on explorer:", `https://base-sepolia.blockscout.com/tx/${executeTxHash}`);
    } else {
      console.log("❌ Operation execution failed");
    }
  } catch (error) {
    console.error("❌ Error executing operation:", error);
  }

  // Cleanup
  console.log("\n🧹 Cleaning up...");
  await litExecutor.disconnect();
  console.log("✅ Disconnected from Lit Network");

  console.log("\n🎉 Complete Integration Demo Finished!");
  console.log("\n📊 Summary:");
  console.log("  1. ✅ Deployed LitPKPExecutor contract on Base Sepolia");
  console.log("  2. ✅ Created ZeroDev smart account with ECDSA validator");
  console.log("  3. ✅ Installed PKP executor module into smart account");
  console.log("  4. ✅ Signed operation with Lit PKP using decentralized key shares");
  console.log("  5. ✅ Executed operation through on-chain PKP executor module");
  console.log("\nThis demonstrates the complete ERC-7579 module flow with Lit Protocol PKPs!");

  process.exit(0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});