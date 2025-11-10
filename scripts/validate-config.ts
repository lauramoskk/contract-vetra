import {
  NODE_ENV,
  getNetworkName,
  getRpcUrl,
  getChainId,
  getAdminAddress,
  getMinterAddress,
  getBurnerAddress,
  getReserveTTL,
  getFunctionsRouter,
  getDonId,
  getSubscriptionId,
  getLinkToken,
  getReserveApiUrl,
  getReserveUpdateInterval,
  getMintPerTxLimit,
  isAllowlistEnabled,
  displayConfig,
} from "../config/env";
import { ethers } from "ethers";

async function main() {
  console.log("\n========================================");
  console.log("CONFIGURATION VALIDATION");
  console.log("========================================\n");

  displayConfig();

  let errors = 0;
  let warnings = 0;

  // Validate environment
  console.log("Validating configuration...\n");

  // Check NODE_ENV
  if (NODE_ENV !== "development" && NODE_ENV !== "production") {
    console.error("❌ NODE_ENV must be 'development' or 'production'");
    errors++;
  } else {
    console.log(`✅ NODE_ENV: ${NODE_ENV}`);
  }

  // Validate addresses
  const addresses = {
    Admin: getAdminAddress(),
    Minter: getMinterAddress(),
    Burner: getBurnerAddress(),
    "Functions Router": getFunctionsRouter(),
    "LINK Token": getLinkToken(),
  };

  for (const [name, address] of Object.entries(addresses)) {
    if (!ethers.isAddress(address)) {
      console.error(`❌ Invalid ${name} address: ${address}`);
      errors++;
    } else {
      console.log(`✅ ${name}: ${address}`);
    }
  }

  // Validate numeric values
  const chainId = getChainId();
  const expectedChainId = NODE_ENV === "production" ? 137 : 80002;
  if (chainId !== expectedChainId) {
    console.error(
      `❌ Chain ID mismatch. Expected ${expectedChainId}, got ${chainId}`
    );
    errors++;
  } else {
    console.log(`✅ Chain ID: ${chainId}`);
  }

  const reserveTTL = getReserveTTL();
  if (reserveTTL < 300 || reserveTTL > 3600) {
    console.warn(
      `⚠️  Reserve TTL (${reserveTTL}s) is outside recommended range (300-3600s)`
    );
    warnings++;
  } else {
    console.log(`✅ Reserve TTL: ${reserveTTL} seconds`);
  }

  // Validate subscription ID
  const subId = getSubscriptionId();
  if (subId === "0") {
    console.warn(
      "⚠️  Chainlink subscription ID is 0. Make sure to update before deployment."
    );
    warnings++;
  } else {
    console.log(`✅ Subscription ID: ${subId}`);
  }

  // Validate DON ID format
  const donId = getDonId();
  if (!donId.startsWith("0x")) {
    console.error(`❌ DON ID must be a hex string starting with 0x`);
    errors++;
  } else {
    console.log(`✅ DON ID: ${donId}`);
  }

  // Validate RPC URL
  const rpcUrl = getRpcUrl();
  if (!rpcUrl.startsWith("http://") && !rpcUrl.startsWith("https://")) {
    console.error(`❌ Invalid RPC URL: ${rpcUrl}`);
    errors++;
  } else {
    console.log(`✅ RPC URL: ${rpcUrl}`);
  }

  // Validate Reserve API URL
  const apiUrl = getReserveApiUrl();
  if (!apiUrl.startsWith("http://") && !apiUrl.startsWith("https://")) {
    console.error(`❌ Invalid Reserve API URL: ${apiUrl}`);
    errors++;
  } else {
    console.log(`✅ Reserve API URL: ${apiUrl}`);
  }

  // Test RPC connection
  console.log("\nTesting RPC connection...");
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const network = await provider.getNetwork();
    const blockNumber = await provider.getBlockNumber();

    if (Number(network.chainId) !== chainId) {
      console.error(
        `❌ RPC chain ID (${network.chainId}) doesn't match config (${chainId})`
      );
      errors++;
    } else {
      console.log(`✅ Connected to chain ${network.chainId}`);
      console.log(`✅ Current block: ${blockNumber}`);
    }
  } catch (error: any) {
    console.error(`❌ RPC connection failed: ${error.message}`);
    errors++;
  }

  // Check deployment readiness
  console.log("\n========================================");
  console.log("DEPLOYMENT READINESS");
  console.log("========================================\n");

  const networkName = getNetworkName();
  if (NODE_ENV === "production") {
    console.log("🚨 MAINNET DEPLOYMENT CHECK");
    console.log("\nBefore deploying to mainnet, ensure:");
    console.log("1. ✓ All tests pass on testnet");
    console.log("2. ✓ Contract verified on Amoy testnet");
    console.log("3. ✓ Reserve updates working on testnet");
    console.log("4. ✓ Admin/minter/burner wallets are secured (hardware wallet)");
    console.log("5. ✓ Chainlink Functions subscription is funded");
    console.log("6. ✓ Deployer wallet has sufficient POL for gas");
    console.log("7. ✓ FT Asset Management API is accessible");
    console.log("\n⚠️  NEVER commit .env to version control!");
  } else {
    console.log("🧪 TESTNET DEPLOYMENT CHECK");
    console.log("\nBefore deploying to testnet, ensure:");
    console.log("1. ✓ Deployer wallet funded with 3 AMOY POL");
    console.log("2. ✓ Deployer wallet funded with 2 test LINK");
    console.log("3. ✓ Chainlink Functions subscription created");
    console.log("4. ✓ All tests pass locally");
  }

  // Summary
  console.log("\n========================================");
  console.log("VALIDATION SUMMARY");
  console.log("========================================");
  console.log(`Environment: ${NODE_ENV}`);
  console.log(`Network: ${networkName}`);
  console.log(`Errors: ${errors}`);
  console.log(`Warnings: ${warnings}`);

  if (errors > 0) {
    console.log("\n❌ Configuration has errors. Fix them before deployment.");
    process.exit(1);
  } else if (warnings > 0) {
    console.log(
      "\n⚠️  Configuration has warnings. Review them before deployment."
    );
  } else {
    console.log("\n✅ Configuration is valid!");
  }

  console.log("========================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
