import { ethers } from "ethers";
import { config as dotenvConfig } from "dotenv";
import fs from "fs";
import path from "path";

dotenvConfig();

async function main() {
  console.log("🚀 Deploying LitPKPExecutor contract...");

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(process.env.ZERODEV_BASE_SEPOLIA_RPC);
  const wallet = new ethers.Wallet(process.env.WALLET_PRIVATE_KEY!, provider);

  console.log("📋 Deploying with wallet:", wallet.address);

  // Load contract artifacts
  const contractPath = path.join(process.cwd(), "artifacts/contracts/LitPKPExecutor.sol/LitPKPExecutor.json");
  const contractArtifact = JSON.parse(fs.readFileSync(contractPath, "utf8"));

  // Deploy contract
  const contractFactory = new ethers.ContractFactory(
    contractArtifact.abi,
    contractArtifact.bytecode,
    wallet
  );

  const litPKPExecutor = await contractFactory.deploy();
  await litPKPExecutor.waitForDeployment();

  const address = await litPKPExecutor.getAddress();
  console.log("✅ LitPKPExecutor deployed to:", address);

  // Verify the deployment
  const moduleType = await litPKPExecutor.MODULE_TYPE();
  console.log("📋 Module Type:", moduleType.toString());

  const network = await provider.getNetwork();
  console.log("\n📝 Contract deployment summary:");
  console.log("  - Contract Address:", address);
  console.log("  - Module Type: Executor (2)");
  console.log("  - Network:", network.name);
  console.log("  - Chain ID:", network.chainId);

  return address;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

export default main;