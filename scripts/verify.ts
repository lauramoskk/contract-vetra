import { run } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { getNetworkName } from "../config/env";

async function main() {
  console.log("\n========================================");
  console.log("VETRA CONTRACT VERIFICATION");
  console.log("========================================\n");

  const networkName = getNetworkName();
  console.log("Network:", networkName);

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
  const implementationAddress = deployment.implementation;

  console.log("Proxy address:", proxyAddress);
  console.log("Implementation address:", implementationAddress);
  console.log("");

  console.log("Verifying implementation contract on Polygonscan...");
  console.log("This may take a few moments...\n");

  try {
    await run("verify:verify", {
      address: implementationAddress,
      constructorArguments: [],
    });

    console.log("✅ Implementation verified successfully!");
  } catch (error: any) {
    if (error.message.includes("Already Verified")) {
      console.log("✅ Contract is already verified!");
    } else {
      console.error("❌ Verification failed:");
      console.error(error.message);
      throw error;
    }
  }

  console.log("\n========================================");
  console.log("VERIFICATION SUMMARY");
  console.log("========================================");
  console.log("Implementation:", implementationAddress);
  console.log("Status: Verified ✅");
  console.log("");
  console.log("View on Polygonscan:");

  if (networkName === "polygon") {
    console.log(
      `https://polygonscan.com/address/${implementationAddress}#code`
    );
    console.log(`https://polygonscan.com/address/${proxyAddress}#code`);
  } else if (networkName === "amoy") {
    console.log(
      `https://amoy.polygonscan.com/address/${implementationAddress}#code`
    );
    console.log(`https://amoy.polygonscan.com/address/${proxyAddress}#code`);
  }

  console.log("========================================\n");

  console.log("Note: The proxy contract should automatically show as a proxy");
  console.log("      and link to the implementation on Polygonscan.\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
