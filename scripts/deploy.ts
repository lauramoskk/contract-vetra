import { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import {
  displayConfig,
  getAdminAddress,
  getMinterAddress,
  getBurnerAddress,
  getReserveTTL,
  getFunctionsRouter,
  getDonId,
  getSubscriptionId,
  getNetworkName,
} from "../config/env";

async function main() {
  console.log("\n========================================");
  console.log("VETRA STABLECOIN DEPLOYMENT");
  console.log("========================================\n");

  // Display configuration
  displayConfig();

  // Get deployer
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "POL\n");

  if (balance === 0n) {
    throw new Error("Deployer account has zero balance. Please fund it first.");
  }

  // Get initialization parameters from env
  const adminAddress = getAdminAddress();
  const minterAddress = getMinterAddress();
  const burnerAddress = getBurnerAddress();
  const reserveTTL = getReserveTTL();
  const functionsRouter = getFunctionsRouter();
  const donId = getDonId();
  const subscriptionId = getSubscriptionId();
  const gasLimit = 300000; // 300k gas for Chainlink Functions callback

  console.log("Initialization Parameters:");
  console.log("- Admin:", adminAddress);
  console.log("- Minter:", minterAddress);
  console.log("- Burner:", burnerAddress);
  console.log("- Reserve TTL:", reserveTTL, "seconds");
  console.log("- Functions Router:", functionsRouter);
  console.log("- DON ID:", donId);
  console.log("- Subscription ID:", subscriptionId);
  console.log("- Gas Limit:", gasLimit);
  console.log("");

  // Deploy Vetra as UUPS proxy
  console.log("Deploying Vetra (UUPS proxy)...");
  const VetraFactory = await ethers.getContractFactory("Vetra");

  const vetra = await upgrades.deployProxy(
    VetraFactory,
    [
      adminAddress,
      minterAddress,
      burnerAddress,
      reserveTTL,
      functionsRouter,
      donId,
      subscriptionId,
      gasLimit,
    ],
    {
      initializer: "initialize",
      kind: "uups",
    }
  );

  await vetra.waitForDeployment();
  const proxyAddress = await vetra.getAddress();

  console.log("✅ Vetra proxy deployed at:", proxyAddress);

  // Get implementation address
  const implementationAddress = await upgrades.erc1967.getImplementationAddress(
    proxyAddress
  );
  console.log("✅ Implementation deployed at:", implementationAddress);

  // Get admin address (proxy admin)
  const adminSlot = await upgrades.erc1967.getAdminAddress(proxyAddress);
  console.log("✅ Proxy admin at:", adminSlot);

  // Verify deployment
  console.log("\nVerifying deployment...");
  const name = await vetra.name();
  const symbol = await vetra.symbol();
  const decimals = await vetra.decimals();
  const totalSupply = await vetra.totalSupply();

  console.log("- Token name:", name);
  console.log("- Token symbol:", symbol);
  console.log("- Decimals:", decimals);
  console.log("- Total supply:", ethers.formatEther(totalSupply));

  // Verify roles
  const DEFAULT_ADMIN_ROLE = await vetra.DEFAULT_ADMIN_ROLE();
  const MINTER_ROLE = await vetra.MINTER_ROLE();
  const BURNER_ROLE = await vetra.BURNER_ROLE();

  const hasAdminRole = await vetra.hasRole(DEFAULT_ADMIN_ROLE, adminAddress);
  const hasMinterRole = await vetra.hasRole(MINTER_ROLE, minterAddress);
  const hasBurnerRole = await vetra.hasRole(BURNER_ROLE, burnerAddress);

  console.log("\nRole verification:");
  console.log("- Admin role assigned:", hasAdminRole ? "✅" : "❌");
  console.log("- Minter role assigned:", hasMinterRole ? "✅" : "❌");
  console.log("- Burner role assigned:", hasBurnerRole ? "✅" : "❌");

  // Verify configuration
  const configTTL = await vetra.reserveTTL();
  const configRouter = await vetra.functionsRouter();
  const configDonId = await vetra.donId();
  const configSubId = await vetra.subscriptionId();

  console.log("\nConfiguration verification:");
  console.log("- Reserve TTL:", configTTL.toString(), "seconds");
  console.log("- Functions Router:", configRouter);
  console.log("- DON ID:", configDonId);
  console.log("- Subscription ID:", configSubId.toString());

  // Save deployment info
  const networkName = getNetworkName();
  const deploymentInfo = {
    network: networkName,
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    proxy: proxyAddress,
    implementation: implementationAddress,
    proxyAdmin: adminSlot,
    config: {
      admin: adminAddress,
      minter: minterAddress,
      burner: burnerAddress,
      reserveTTL: reserveTTL,
      functionsRouter: functionsRouter,
      donId: donId,
      subscriptionId: subscriptionId,
      gasLimit: gasLimit,
    },
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const filename = path.join(deploymentsDir, `${networkName}.json`);
  fs.writeFileSync(filename, JSON.stringify(deploymentInfo, null, 2));

  console.log("\n✅ Deployment info saved to:", filename);

  console.log("\n========================================");
  console.log("DEPLOYMENT SUMMARY");
  console.log("========================================");
  console.log("Network:", networkName);
  console.log("Proxy Address:", proxyAddress);
  console.log("Implementation:", implementationAddress);
  console.log("========================================");
  console.log("\nNext steps:");
  console.log("1. Fund the Chainlink subscription (if not done)");
  console.log("2. Add this contract as a consumer to the subscription");
  console.log("3. Run: npm run update-reserve:" + networkName);
  console.log("4. Run: npm run verify:" + networkName);
  console.log("========================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
