import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { getNetworkName, displayConfig } from "../config/env";

/**
 * Test Minting Script
 *
 * This script tests the minting functionality with live reserves.
 * It checks reserve status, calculates available capacity, and performs a test mint.
 */

async function main() {
  console.log("\n========================================");
  console.log("VETRA TEST MINT");
  console.log("========================================\n");

  displayConfig();

  const networkName = getNetworkName();
  const [signer] = await ethers.getSigners();

  console.log("Minting with account:", signer.address);

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

  // Check that caller has minter role
  const MINTER_ROLE = await vetra.MINTER_ROLE();
  const hasMinterRole = await vetra.hasRole(MINTER_ROLE, signer.address);

  if (!hasMinterRole) {
    throw new Error(
      `Account ${signer.address} does not have MINTER_ROLE. Only minter can mint tokens.`
    );
  }

  console.log("✅ Caller has MINTER_ROLE\n");

  // Check current contract state
  console.log("========================================");
  console.log("CURRENT CONTRACT STATE");
  console.log("========================================");

  const totalSupply = await vetra.totalSupply();
  const lastReserveUsd = await vetra.lastReserveUsd();
  const lastReserveTimestamp = await vetra.lastReserveTimestamp();
  const lastReserveNonce = await vetra.lastReserveNonce();
  const reserveTTL = await vetra.reserveTTL();
  const isPaused = await vetra.paused();

  console.log("Total Supply:", ethers.formatEther(totalSupply), "VTR");
  console.log("Last Reserve USD (8 decimals):", lastReserveUsd.toString());
  console.log(
    "Last Reserve Timestamp:",
    lastReserveTimestamp.toString() === "0"
      ? "Never set"
      : new Date(Number(lastReserveTimestamp) * 1000).toISOString()
  );
  console.log("Last Reserve Nonce:", lastReserveNonce.toString());
  console.log("Reserve TTL:", reserveTTL.toString(), "seconds");
  console.log("Contract Paused:", isPaused);
  console.log("");

  // Calculate reserve age
  if (lastReserveTimestamp > 0n) {
    const currentBlock = await ethers.provider.getBlock("latest");
    const currentTimestamp = currentBlock!.timestamp;
    const reserveAge = currentTimestamp - Number(lastReserveTimestamp);
    const isFresh = reserveAge <= Number(reserveTTL);

    console.log("Reserve Age:", reserveAge, "seconds");
    console.log("Reserve Status:", isFresh ? "✅ Fresh" : "❌ Stale");
    console.log("");

    if (!isFresh) {
      console.log("⚠️  Reserve is stale! Minting will fail.");
      console.log("   Run: npm run update-reserve:" + networkName);
      console.log("   Then wait 1-2 minutes for Chainlink Functions to fulfill.\n");
      process.exit(1);
    }
  } else {
    console.log("❌ Reserve has never been set!");
    console.log("   Run: npm run update-reserve:" + networkName);
    console.log("   Then wait 1-2 minutes for Chainlink Functions to fulfill.\n");
    process.exit(1);
  }

  // Calculate available minting capacity
  const RESERVE_TO_TOKEN_SCALE = 10n ** 10n; // 10^10
  const reserveScaled = lastReserveUsd * RESERVE_TO_TOKEN_SCALE;
  const availableCapacity = reserveScaled - totalSupply;

  console.log("========================================");
  console.log("MINTING CAPACITY");
  console.log("========================================");
  console.log(
    "Reserve (8 decimals):",
    lastReserveUsd.toString(),
    "→",
    ethers.formatEther(reserveScaled),
    "VTR max supply"
  );
  console.log("Current Supply:", ethers.formatEther(totalSupply), "VTR");
  console.log(
    "Available Capacity:",
    ethers.formatEther(availableCapacity),
    "VTR"
  );
  console.log("");

  if (availableCapacity <= 0n) {
    console.log("❌ No minting capacity available!");
    console.log("   Reserve:", ethers.formatEther(reserveScaled), "VTR");
    console.log("   Supply:", ethers.formatEther(totalSupply), "VTR");
    console.log(
      "\n   You've already minted all available tokens based on current reserves.\n"
    );
    process.exit(1);
  }

  // Determine mint amount (small test amount)
  const TEST_MINT_AMOUNT = ethers.parseEther("100"); // 100 VTR
  const mintAmount =
    availableCapacity < TEST_MINT_AMOUNT ? availableCapacity : TEST_MINT_AMOUNT;

  console.log("========================================");
  console.log("MINT TEST");
  console.log("========================================");
  console.log("Test mint amount:", ethers.formatEther(mintAmount), "VTR");
  console.log("Recipient:", signer.address);
  console.log("");

  // Confirm mint
  console.log("⏳ Preparing to mint...");
  console.log("");

  try {
    // Execute mint
    const tx = await vetra.mint(signer.address, mintAmount);
    console.log("Transaction hash:", tx.hash);
    console.log("Waiting for confirmation...");

    const receipt = await tx.wait();
    console.log("✅ Transaction confirmed in block:", receipt?.blockNumber);

    // Parse events
    const events = receipt?.logs
      .map((log: any) => {
        try {
          return vetra.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .filter((e: any) => e !== null);

    const mintEvent = events?.find((e: any) => e?.name === "TokensMinted");

    if (mintEvent) {
      const to = mintEvent.args[0];
      const amount = mintEvent.args[1];
      const operator = mintEvent.args[2];
      const totalSupplyAfter = mintEvent.args[3];
      const reserveAfter = mintEvent.args[4];
      const timestamp = mintEvent.args[5];

      console.log("\n✅ Tokens minted successfully!");
      console.log("========================================");
      console.log("MINT EVENT DETAILS");
      console.log("========================================");
      console.log("Recipient:", to);
      console.log("Amount:", ethers.formatEther(amount), "VTR");
      console.log("Operator:", operator);
      console.log("Total Supply After:", ethers.formatEther(totalSupplyAfter), "VTR");
      console.log("Reserve After:", reserveAfter.toString());
      console.log(
        "Timestamp:",
        new Date(Number(timestamp) * 1000).toISOString()
      );
      console.log("");
    }

    // Check new balances
    const newTotalSupply = await vetra.totalSupply();
    const recipientBalance = await vetra.balanceOf(signer.address);

    console.log("========================================");
    console.log("POST-MINT STATE");
    console.log("========================================");
    console.log("New Total Supply:", ethers.formatEther(newTotalSupply), "VTR");
    console.log("Recipient Balance:", ethers.formatEther(recipientBalance), "VTR");
    console.log(
      "Remaining Capacity:",
      ethers.formatEther(reserveScaled - newTotalSupply),
      "VTR"
    );
    console.log("");

    console.log("========================================");
    console.log("MINT TEST SUMMARY");
    console.log("========================================");
    console.log("Status: Success ✅");
    console.log("Transaction:", tx.hash);
    console.log("Amount Minted:", ethers.formatEther(mintAmount), "VTR");
    console.log("Network:", networkName);
    console.log("========================================\n");
  } catch (error: any) {
    console.error("\n❌ Mint failed:");
    console.error(error.message);

    if (error.message.includes("ReserveStale")) {
      console.error("\n💡 Reserve is stale. Update reserves and try again:");
      console.error("   npm run update-reserve:" + networkName);
    } else if (error.message.includes("ReserveInsufficient")) {
      console.error("\n💡 Insufficient reserves. Current reserves don't cover this mint.");
      console.error("   Wait for FT Asset Management to increase USD backing.");
    } else if (error.message.includes("Pausable: paused")) {
      console.error("\n💡 Contract is paused. Unpause it first (admin only).");
    } else if (error.message.includes("MintLimitExceeded")) {
      console.error("\n💡 Mint amount exceeds per-transaction limit.");
    } else if (error.message.includes("RecipientNotAllowed")) {
      console.error("\n💡 Recipient not on allowlist.");
    }

    console.error("");
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
