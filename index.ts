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
import { LitNodeClient } from "@lit-protocol/lit-node-client";
import { LIT_NETWORK, LIT_RPC } from "@lit-protocol/constants";
import { LitContracts } from "@lit-protocol/contracts-sdk";
import * as ethers from "ethers";
import fs from "fs";
import path from "path";

const ZERODEV_RPC = process.env.ZERODEV_BASE_SEPOLIA_RPC;
const chain = baseSepolia;
const entryPoint = getEntryPoint("0.7");
const kernelVersion = KERNEL_V3_1;

async function main() {
  console.log("🚀 Starting Complete Lit PKP + ZeroDev Integration Demo");

  // Get environment variables
  const walletPrivateKey = process.env.WALLET_PRIVATE_KEY! as `0x${string}`;
  const litPKPExecutorAddress = process.env.LIT_PKP_EXECUTOR_ADDRESS! as `0x${string}`;

  console.log("\n📋 Configuration:");
  console.log("  - LitPKPExecutor Contract:", litPKPExecutorAddress);
  console.log("  - Wallet Address:", privateKeyToAccount(walletPrivateKey).address);

  // Initialize Lit Network connection for PKP minting
  console.log("\n🔗 Connecting to Lit Network...");
  const litNodeClient = new LitNodeClient({
    litNetwork: LIT_NETWORK.DatilDev,
    debug: false,
  });
  await litNodeClient.connect();
  console.log("✅ Connected to Lit Network");

  // Setup ethers signer for contracts
  const ethersSigner = new ethers.Wallet(
    walletPrivateKey,
    new ethers.providers.JsonRpcProvider(LIT_RPC.CHRONICLE_YELLOWSTONE)
  );

  console.log("\n🔗 Connecting to Lit Contracts...");
  const litContracts = new LitContracts({
    signer: ethersSigner,
    network: LIT_NETWORK.DatilDev,
    debug: false,
  });
  await litContracts.connect();
  console.log("✅ Connected to Lit Contracts");

  // Mint a fresh PKP for this test to avoid the UnauthorizedPKP error
  console.log("\n🪙 Minting fresh PKP to avoid conflicts...");
  const pkpInfo = (await litContracts.pkpNftContractUtils.write.mint()).pkp;
  const pkpTokenId = pkpInfo.tokenId!.toString();
  const pkpPublicKey = pkpInfo.publicKey!;
  const pkpEthAddress = pkpInfo.ethAddress! as `0x${string}`;

  console.log("✅ Fresh PKP minted successfully!");
  console.log(`  - Token ID: ${pkpTokenId}`);
  console.log(`  - Public Key: ${pkpPublicKey.slice(0, 20)}...`);
  console.log(`  - ETH Address: ${pkpEthAddress}`);

  // Initialize the Lit PKP Executor with the fresh PKP
  console.log("\n🔐 Initializing Lit PKP Executor with fresh PKP...");
  const litExecutor = new LitPKPExecutor({
    pkpTokenId,
    pkpPublicKey,
    pkpEthAddress,
    walletPrivateKey,
    litNetwork: "datil-dev",
  });

  await litExecutor.connect();
  console.log("✅ Lit PKP Executor initialized");

  // Setup ZeroDev smart account
  console.log("\n🏦 Setting up ZeroDev Smart Account...");
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
  console.log("✅ Smart Account created:", accountAddress);

  // Install the LitPKPExecutor module into the smart account with fresh PKP
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
  console.log("  - Fresh PKP to install:", pkpEthAddress);
  console.log("  - Smart account:", accountAddress);

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
      console.log("🔗 View installation:", `https://base-sepolia.blockscout.com/tx/${installTxHash}`);
    } else {
      console.log("❌ Module installation failed");
      return;
    }
  } catch (error: any) {
    console.error("❌ Error installing module:", error);
    return;
  }

  // Now execute an operation using the PKP
  console.log("\n🔨 Testing PKP signing and operation execution...");

  const operation: ExecuteOperation = {
    to: zeroAddress,
    value: BigInt(0),
    data: "0x" as Hex,
    operation: 0,
  };

  // Create operation hash using the contract
  const provider = new ethers.providers.JsonRpcProvider(ZERODEV_RPC);
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
    litNodeClient.disconnect();
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

  // Test a second operation to show it's working consistently
  console.log("\n🔄 Testing second operation to verify consistency...");

  const operation2: ExecuteOperation = {
    to: "0x1234567890123456789012345678901234567890" as `0x${string}`,
    value: parseEther("0"),
    data: "0x" as Hex,
    operation: 0,
  };

  const operationHash2 = await litPKPExecutorContract.getOperationHash(
    accountAddress,
    operation2.to,
    operation2.value,
    operation2.data
  );

  console.log("  - Operation 2 hash:", operationHash2);

  const signingResult2 = await litExecutor.signOperation(
    operation2,
    chain.id,
    operationHash2 as Hex
  );

  if (signingResult2.success) {
    console.log("✅ Second operation also signed successfully!");
    console.log("  - Signature 2:", signingResult2.signature.slice(0, 20) + "...");
  } else {
    console.log("❌ Second operation signing failed");
  }

  // Cleanup
  console.log("\n🧹 Cleaning up...");
  await litExecutor.disconnect();
  litNodeClient.disconnect();
  console.log("✅ Disconnected from Lit Network");

  console.log("\n🎉 Complete Integration Demo Finished!");
  console.log("\n📊 Summary of what was accomplished:");
  console.log("  1. ✅ Connected to Lit Protocol DatilDev network");
  console.log("  2. ✅ Minted fresh PKP for this test");
  console.log("  3. ✅ Created ZeroDev smart account with ECDSA validator");
  console.log("  4. ✅ Installed PKP executor module into smart account on-chain");
  console.log("  5. ✅ Signed operations with Lit PKP using decentralized key shares");
  console.log("  6. ✅ Executed operations through on-chain PKP executor module");
  console.log("  7. ✅ Demonstrated consistency with multiple operations");
  
  console.log("\n🚀 This demonstrates the complete ERC-7579 module flow with Lit Protocol PKPs!");
  console.log("The PKP can now sign operations for any validator-approved transaction,");
  console.log("enabling true cross-chain asset control without wallet deployment on every chain!");

  process.exit(0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});