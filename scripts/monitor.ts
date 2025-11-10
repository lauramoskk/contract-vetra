import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { getNetworkName } from "../config/env";

async function main() {
  console.log("\n========================================");
  console.log("VETRA EVENT MONITOR");
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

  console.log("Vetra contract:", proxyAddress);
  console.log("Monitoring events... (Press Ctrl+C to stop)\n");

  // Get contract instance
  const vetra = await ethers.getContractAt("Vetra", proxyAddress);

  // Get current block number
  const currentBlock = await ethers.provider.getBlockNumber();
  console.log("Current block:", currentBlock);
  console.log("Fetching recent events (last 1000 blocks)...\n");

  const fromBlock = Math.max(0, currentBlock - 1000);

  // Fetch all events
  const allEvents = await vetra.queryFilter("*", fromBlock, "latest");

  if (allEvents.length === 0) {
    console.log("No events found in recent blocks.\n");
  } else {
    console.log(`Found ${allEvents.length} events:\n`);
    console.log("========================================");

    for (const log of allEvents) {
      // Type guard to ensure we have an EventLog
      if (!("eventName" in log) || !log.args) {
        continue; // Skip non-EventLog entries
      }

      const event = log; // Now TypeScript knows this is EventLog
      const block = await event.getBlock();
      const timestamp = new Date(Number(block.timestamp) * 1000);
      const eventName = event.eventName || "Unknown";

      console.log(`\n[${eventName}]`);
      console.log(`Block: ${event.blockNumber} | ${timestamp.toISOString()}`);
      console.log(`Transaction: ${event.transactionHash}`);

      switch (eventName) {
        case "TokensMinted":
          console.log(`  To: ${event.args[0]}`);
          console.log(`  Amount: ${ethers.formatEther(event.args[1])} VTR`);
          console.log(`  Operator: ${event.args[2]}`);
          console.log(
            `  Total Supply After: ${ethers.formatEther(event.args[3])} VTR`
          );
          console.log(
            `  Reserve After: ${(Number(event.args[4]) / 100000000).toFixed(2)} USD`
          );
          break;

        case "TokensBurned":
          console.log(`  From: ${event.args[0]}`);
          console.log(`  Amount: ${ethers.formatEther(event.args[1])} VTR`);
          console.log(`  Operator: ${event.args[2]}`);
          console.log(
            `  Total Supply After: ${ethers.formatEther(event.args[3])} VTR`
          );
          break;

        case "ReserveUpdateRequested":
          console.log(`  Request ID: ${event.args[0]}`);
          console.log(`  Requester: ${event.args[1]}`);
          console.log(
            `  Timestamp: ${new Date(Number(event.args[2]) * 1000).toISOString()}`
          );
          break;

        case "ReserveUpdated":
          const usdAmount = Number(event.args[0]) / 100000000; // 8 decimals
          console.log(`  USD Amount: $${usdAmount.toFixed(2)}`);
          console.log(`  Nonce: ${event.args[1]}`);
          console.log(
            `  Timestamp: ${new Date(Number(event.args[2]) * 1000).toISOString()}`
          );
          console.log(`  Request ID: ${event.args[3]}`);
          break;

        case "ReserveTTLUpdated":
          console.log(`  Old TTL: ${event.args[0]} seconds`);
          console.log(`  New TTL: ${event.args[1]} seconds`);
          break;

        case "MintLimitUpdated":
          console.log(`  Old Limit: ${ethers.formatEther(event.args[0])} VTR`);
          console.log(`  New Limit: ${ethers.formatEther(event.args[1])} VTR`);
          break;

        case "AllowlistStatusUpdated":
          console.log(`  Enabled: ${event.args[0]}`);
          break;

        case "AllowlistAddressUpdated":
          console.log(`  Address: ${event.args[0]}`);
          console.log(`  Allowed: ${event.args[1]}`);
          break;

        case "ChainlinkConfigUpdated":
          console.log(`  Router: ${event.args[0]}`);
          console.log(`  DON ID: ${event.args[1]}`);
          console.log(`  Subscription ID: ${event.args[2]}`);
          break;

        case "Paused":
          console.log(`  Account: ${event.args[0]}`);
          break;

        case "Unpaused":
          console.log(`  Account: ${event.args[0]}`);
          break;

        case "RoleGranted":
          console.log(`  Role: ${event.args[0]}`);
          console.log(`  Account: ${event.args[1]}`);
          console.log(`  Sender: ${event.args[2]}`);
          break;

        case "RoleRevoked":
          console.log(`  Role: ${event.args[0]}`);
          console.log(`  Account: ${event.args[1]}`);
          console.log(`  Sender: ${event.args[2]}`);
          break;

        case "Upgraded":
          console.log(`  Implementation: ${event.args[0]}`);
          break;

        default:
          console.log(`  Args:`, event.args);
          break;
      }

      console.log("----------------------------------------");
    }
  }

  // Display current state
  console.log("\n========================================");
  console.log("CURRENT STATE");
  console.log("========================================");

  const totalSupply = await vetra.totalSupply();
  const reserveUsd = await vetra.lastReserveUsd();
  const reserveTimestamp = await vetra.lastReserveTimestamp();
  const reserveNonce = await vetra.lastReserveNonce();
  const reserveTTL = await vetra.reserveTTL();
  const isReserveFresh = await vetra.isReserveFresh();
  const availableCapacity = await vetra.availableMintCapacity();
  const isPaused = await vetra.paused();

  console.log(`Total Supply: ${ethers.formatEther(totalSupply)} VTR`);
  console.log(
    `Reserve USD: $${(Number(reserveUsd) / 100000000).toFixed(2)}`
  );
  console.log(
    `Reserve Last Updated: ${
      Number(reserveTimestamp) === 0
        ? "Never"
        : new Date(Number(reserveTimestamp) * 1000).toISOString()
    }`
  );
  console.log(`Reserve Nonce: ${reserveNonce}`);
  console.log(`Reserve TTL: ${reserveTTL} seconds`);
  console.log(`Reserve Fresh: ${isReserveFresh ? "✅ Yes" : "❌ No"}`);
  console.log(
    `Available Mint Capacity: ${ethers.formatEther(availableCapacity)} VTR`
  );
  console.log(`Paused: ${isPaused ? "⚠️  Yes" : "✅ No"}`);
  console.log("========================================\n");

  // Setup real-time listener
  console.log("Setting up real-time event listeners...\n");

  vetra.on("*", (event) => {
    console.log(`\n🔔 New Event: ${event.eventName || "Unknown"}`);
    console.log(`Block: ${event.log.blockNumber}`);
    console.log(`Transaction: ${event.log.transactionHash}`);
    console.log(`Args:`, event.args);
    console.log("----------------------------------------");
  });

  // Keep script running
  await new Promise(() => {});
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
