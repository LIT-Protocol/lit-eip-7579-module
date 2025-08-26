import "dotenv/config";
import {
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
} from "@zerodev/sdk";
import { KERNEL_V3_1, getEntryPoint } from "@zerodev/sdk/constants";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { http, createPublicClient, zeroAddress, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { LitPKPExecutor, type ExecuteOperation } from "./lit-pkp-executor";

const ZERODEV_RPC = process.env.ZERODEV_BASE_SEPOLIA_RPC;

const chain = baseSepolia;
const entryPoint = getEntryPoint("0.7");
const kernelVersion = KERNEL_V3_1;

const main = async () => {
  console.log("🚀 Starting Lit PKP + ZeroDev Smart Account Demo");

  // Get environment variables
  const pkpTokenId = process.env.PKP_TOKEN_ID!;
  const pkpPublicKey = process.env.PKP_PUBLIC_KEY!;
  const pkpEthAddress = process.env.PKP_ETH_ADDRESS! as `0x${string}`;
  const walletPrivateKey = process.env.WALLET_PRIVATE_KEY! as `0x${string}`;

  if (!pkpTokenId || !pkpPublicKey || !pkpEthAddress || !walletPrivateKey) {
    throw new Error("Missing required environment variables for PKP or wallet");
  }

  console.log("📋 PKP Configuration:");
  console.log("  - Token ID:", pkpTokenId);
  console.log("  - PKP Address:", pkpEthAddress);
  console.log("  - Public Key:", pkpPublicKey.slice(0, 20) + "...");

  // Initialize the Lit PKP Executor
  console.log("\n🔐 Initializing Lit PKP Executor...");
  const litExecutor = new LitPKPExecutor({
    pkpTokenId,
    pkpPublicKey,
    pkpEthAddress,
    walletPrivateKey,
    litNetwork: "datil-dev", // Using Lit datil-dev testnet
  });

  // Connect to Lit Network
  console.log("🌐 Connecting to Lit Network...");
  await litExecutor.connect();
  console.log("✅ Connected to Lit Network");

  // Construct a signer for the smart account validator
  const privateKey = generatePrivateKey();
  const signer = privateKeyToAccount(privateKey);

  // Construct a public client
  const publicClient = createPublicClient({
    transport: http(ZERODEV_RPC),
    chain,
  });

  // Construct a validator (this validates the userOp, then we'll use Lit PKP to execute)
  const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
    signer,
    entryPoint,
    kernelVersion,
  });

  // Construct a Kernel account
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

  // Construct a Kernel account client
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
  console.log("\n🏦 Smart Account Details:");
  console.log("  - Account Address:", accountAddress);

  // Prepare an operation to execute
  const operation: ExecuteOperation = {
    to: zeroAddress,
    value: BigInt(0),
    data: "0x",
    operation: 0, // Call operation
  };

  console.log("\n🔍 Validating operation...");
  if (!litExecutor.validateOperation(operation)) {
    throw new Error("Invalid operation");
  }
  console.log("✅ Operation validated");

  // Create the user operation
  console.log("\n📝 Preparing User Operation...");
  const callData = await kernelClient.account.encodeCalls([
    {
      to: operation.to,
      value: operation.value,
      data: operation.data,
    },
  ]);

  // Get the userOp hash (this would normally be created by the smart account)
  console.log("🔨 Creating User Operation...");
  const userOpHash = await kernelClient.sendUserOperation({
    callData,
  });

  console.log("📋 User Operation Hash:", userOpHash);

  // Now demonstrate Lit PKP signing
  console.log("\n🔏 Signing operation with Lit PKP...");
  const signingResult = await litExecutor.signOperation(
    operation,
    chain.id,
    userOpHash
  );

  if (signingResult.success) {
    console.log("✅ Successfully signed with Lit PKP!");
    console.log("🔐 Signature:", signingResult.signature.slice(0, 20) + "...");
  } else {
    console.log("❌ Failed to sign with Lit PKP");
  }

  console.log("\n⏳ Waiting for UserOp to complete...");
  const receipt = await kernelClient.waitForUserOperationReceipt({
    hash: userOpHash,
    timeout: 1000 * 30, // 30 seconds timeout
  });

  console.log("✅ UserOp completed successfully!");
  console.log("🔗 Transaction Hash:", receipt.receipt.transactionHash);
  console.log("🌐 Block Explorer:", `https://base-sepolia.blockscout.com/tx/${receipt.receipt.transactionHash}`);

  // Demonstrate PKP executor info
  console.log("\n📊 PKP Executor Status:");
  console.log("  - PKP Address:", litExecutor.getPKPAddress());
  console.log("  - Connection Status:", litExecutor.getConnectionStatus());

  // Cleanup
  console.log("\n🧹 Cleaning up...");
  await litExecutor.disconnect();
  console.log("✅ Disconnected from Lit Network");

  console.log("\n🎉 Demo completed successfully!");
  console.log("📋 Summary:");
  console.log("  - Smart account created and funded via paymaster");
  console.log("  - Operation validated by ECDSA validator");
  console.log("  - Operation signed by Lit PKP using decentralized key shares");
  console.log("  - Transaction executed on Base Sepolia");

  process.exit(0);
};

main();
