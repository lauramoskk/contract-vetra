import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { getNetworkName, displayConfig } from "../config/env";

/**
 * Mint Full Reserve Amount
 *
 * This script mints the MAXIMUM amount of VTR tokens based on current reserves.
 * It will mint: (lastReserveUsd × 10^10) - totalSupply()
 */

async function main() {
  console.log("\n========================================");
  console.log("VETRA FULL RESERVE MINT");
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

  if (lastReserveTimestamp > 0n) {
    console.log(
      "Last Reserve Timestamp:",
      new Date(Number(lastReserveTimestamp) * 1000).toISOString()
    );
  } else {
    console.log("Last Reserve Timestamp: Never set");
  }

  console.log("Last Reserve Nonce:", lastReserveNonce.toString());
  console.log("Reserve TTL:", reserveTTL.toString(), "seconds");
  console.log("Contract Paused:", isPaused);
  console.log("");

  // Calculate reserve age and freshness
  if (lastReserveTimestamp > 0n) {
    const currentBlock = await ethers.provider.getBlock("latest");
    const currentTimestamp = currentBlock!.timestamp;
    const reserveAge = currentTimestamp - Number(lastReserveTimestamp);
    const isFresh = reserveAge <= Number(reserveTTL);

    console.log("Reserve Age:", reserveAge, "seconds");
    console.log("Reserve Status:", isFresh ? "✅ Fresh" : "❌ Stale");
    console.log("");

    if (!isFresh) {
      console.log("❌ Reserve is stale! Minting will fail.");
      console.log("   Run: npx cross-env NODE_ENV=production hardhat run scripts/updateReserve.ts --network polygon");
      console.log("   Then wait 1-2 minutes for Chainlink Functions to fulfill.\n");
      process.exit(1);
    }
  } else {
    console.log("❌ Reserve has never been set!");
    console.log("   Run: npx cross-env NODE_ENV=production hardhat run scripts/updateReserve.ts --network polygon");
    console.log("   Then wait 1-2 minutes for Chainlink Functions to fulfill.\n");
    process.exit(1);
  }

  if (isPaused) {
    console.log("❌ Contract is paused! Minting is disabled.\n");
    process.exit(1);
  }

  // Calculate maximum mintable amount
  const RESERVE_TO_TOKEN_SCALE = 10n ** 10n; // 10^10
  const reserveScaled = lastReserveUsd * RESERVE_TO_TOKEN_SCALE;
  const maxMintable = reserveScaled - totalSupply;

  console.log("========================================");
  console.log("RESERVE CAPACITY CALCULATION");
  console.log("========================================");
  console.log(
    "FT Asset Management Reserve:",
    lastReserveUsd.toString(),
    "(8 decimals)"
  );
  console.log(
    "Scaled to 18 decimals:",
    reserveScaled.toString()
  );
  console.log(
    "Maximum Total Supply:",
    ethers.formatEther(reserveScaled),
    "VTR"
  );
  console.log(
    "Current Total Supply:",
    ethers.formatEther(totalSupply),
    "VTR"
  );
  console.log("");
  console.log(
    "📊 MAXIMUM MINTABLE:",
    ethers.formatEther(maxMintable),
    "VTR"
  );
  console.log("");

  if (maxMintable <= 0n) {
    console.log("✅ ALL RESERVES ALREADY MINTED!");
    console.log("   Current supply equals reserve capacity.");
    console.log("   No additional minting possible.\n");
    process.exit(0);
  }

  // Determine recipient (use signer address)
  const recipient = signer.address;

  console.log("========================================");
  console.log("FULL MINT EXECUTION");
  console.log("========================================");
  console.log("Mint Amount:", ethers.formatEther(maxMintable), "VTR");
  console.log("Recipient:", recipient);
  console.log("");

  // Confirmation
  console.log("⚠️  You are about to mint the FULL reserve amount!");
  console.log("   This will mint", ethers.formatEther(maxMintable), "VTR tokens.");
  console.log("");
  console.log("⏳ Executing mint transaction...");
  console.log("");

  try {
    // Execute mint
    const tx = await vetra.mint(recipient, maxMintable);
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

      console.log("\n✅ FULL RESERVE MINTED SUCCESSFULLY!");
      console.log("========================================");
      console.log("MINT EVENT DETAILS");
      console.log("========================================");
      console.log("Recipient:", to);
      console.log("Amount Minted:", ethers.formatEther(amount), "VTR");
      console.log("Operator:", operator);
      console.log("Total Supply After:", ethers.formatEther(totalSupplyAfter), "VTR");
      console.log("Reserve (8 decimals):", reserveAfter.toString());
      console.log(
        "Timestamp:",
        new Date(Number(timestamp) * 1000).toISOString()
      );
      console.log("");
    }

    // Check final balances
    const newTotalSupply = await vetra.totalSupply();
    const recipientBalance = await vetra.balanceOf(recipient);

    console.log("========================================");
    console.log("FINAL STATE");
    console.log("========================================");
    console.log("Total Supply:", ethers.formatEther(newTotalSupply), "VTR");
    console.log("Recipient Balance:", ethers.formatEther(recipientBalance), "VTR");
    console.log(
      "Remaining Capacity:",
      ethers.formatEther(reserveScaled - newTotalSupply),
      "VTR"
    );
    console.log("");

    // Verify 1:1 backing
    const supplyInUsd = newTotalSupply / RESERVE_TO_TOKEN_SCALE;
    console.log("========================================");
    console.log("1:1 BACKING VERIFICATION");
    console.log("========================================");
    console.log("Reserve USD (8 decimals):", lastReserveUsd.toString());
    console.log("Supply in USD (8 decimals):", supplyInUsd.toString());
    console.log("Ratio:", lastReserveUsd >= supplyInUsd ? "✅ Properly backed 1:1" : "❌ UNDER-COLLATERALIZED!");
    console.log("");

    console.log("========================================");
    console.log("MINT SUMMARY");
    console.log("========================================");
    console.log("Status: Success ✅");
    console.log("Transaction:", tx.hash);
    console.log("Amount Minted:", ethers.formatEther(maxMintable), "VTR");
    console.log("Network:", networkName);
    console.log("Explorer:", networkName === "polygon"
      ? `https://polygonscan.com/tx/${tx.hash}`
      : `https://amoy.polygonscan.com/tx/${tx.hash}`
    );
    console.log("========================================\n");
  } catch (error: any) {
    console.error("\n❌ Mint failed:");
    console.error(error.message);

    if (error.message.includes("ReserveStale")) {
      console.error("\n💡 Reserve is stale. Update reserves and try again:");
      console.error("   npx cross-env NODE_ENV=production hardhat run scripts/updateReserve.ts --network polygon");
    } else if (error.message.includes("ReserveInsufficient")) {
      console.error("\n💡 Insufficient reserves. This should not happen when minting maxMintable.");
      console.error("   Check if reserves were updated during execution.");
    } else if (error.message.includes("Pausable: paused")) {
      console.error("\n💡 Contract is paused. Unpause it first (admin only).");
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
