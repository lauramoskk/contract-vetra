import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { getNetworkName, displayConfig } from "../config/env";

/**
 * Grant MINTER_ROLE to Admin
 *
 * This script grants MINTER_ROLE to the admin account so the admin can also mint tokens.
 */

async function main() {
  console.log("\n========================================");
  console.log("GRANT MINTER_ROLE TO ADMIN");
  console.log("========================================\n");

  displayConfig();

  const networkName = getNetworkName();
  const [signer] = await ethers.getSigners();

  console.log("Admin account:", signer.address);

  const balance = await ethers.provider.getBalance(signer.address);
  console.log("Account balance:", ethers.formatEther(balance), "POL\n");

  // Load deployment info
  const deploymentFile = path.join(
    __dirname,
    "..",
    "deployments",
    `${networkName}.json`
  );

  if (!fs.existsSync(deploymentFile)) {
    throw new Error(
      `Deployment file not found: ${deploymentFile}. Run deployment first.`
    );
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
  const proxyAddress = deployment.proxy;

  console.log("Vetra contract:", proxyAddress);
  console.log("");

  // Get contract instance
  const vetra = await ethers.getContractAt("Vetra", proxyAddress);

  // Check admin role
  const DEFAULT_ADMIN_ROLE = await vetra.DEFAULT_ADMIN_ROLE();
  const hasAdminRole = await vetra.hasRole(DEFAULT_ADMIN_ROLE, signer.address);

  if (!hasAdminRole) {
    throw new Error(
      `Account ${signer.address} does not have DEFAULT_ADMIN_ROLE.`
    );
  }

  console.log("✅ Caller has DEFAULT_ADMIN_ROLE\n");

  // Get MINTER_ROLE
  const MINTER_ROLE = await vetra.MINTER_ROLE();
  const alreadyHasMinterRole = await vetra.hasRole(MINTER_ROLE, signer.address);

  if (alreadyHasMinterRole) {
    console.log("✅ Admin already has MINTER_ROLE!");
    console.log("   No action needed.\n");
    return;
  }

  console.log("Granting MINTER_ROLE to admin...");
  console.log("Admin address:", signer.address);
  console.log("");

  try {
    const tx = await vetra.grantRole(MINTER_ROLE, signer.address);
    console.log("Transaction hash:", tx.hash);
    console.log("Waiting for confirmation...");

    const receipt = await tx.wait();
    console.log("✅ Transaction confirmed in block:", receipt?.blockNumber);

    // Verify role was granted
    const hasRole = await vetra.hasRole(MINTER_ROLE, signer.address);

    console.log("\n========================================");
    console.log("ROLE GRANT SUMMARY");
    console.log("========================================");
    console.log("Status:", hasRole ? "✅ Success" : "❌ Failed");
    console.log("Admin address:", signer.address);
    console.log("MINTER_ROLE:", MINTER_ROLE);
    console.log("Transaction:", tx.hash);
    console.log("Network:", networkName);
    console.log("========================================\n");

    if (hasRole) {
      console.log("✅ Admin can now mint tokens!");
      console.log("   Run: npx hardhat run scripts/mintFull.ts --network " + networkName);
    }
  } catch (error: any) {
    console.error("\n❌ Failed to grant role:");
    console.error(error.message);
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
