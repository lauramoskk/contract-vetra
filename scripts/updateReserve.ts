import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { getNetworkName, getReserveApiUrl, displayConfig } from "../config/env";

async function main() {
  console.log("\n========================================");
  console.log("VETRA RESERVE UPDATE");
  console.log("========================================\n");

  displayConfig();

  const networkName = getNetworkName();
  const [signer] = await ethers.getSigners();

  console.log("Updating reserve with account:", signer.address);

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

  // Check that caller has admin role
  const DEFAULT_ADMIN_ROLE = await vetra.DEFAULT_ADMIN_ROLE();
  const hasAdminRole = await vetra.hasRole(DEFAULT_ADMIN_ROLE, signer.address);

  if (!hasAdminRole) {
    throw new Error(
      `Account ${signer.address} does not have DEFAULT_ADMIN_ROLE. Only admin can request reserve updates.`
    );
  }

  // Prepare Chainlink Functions source code
  const apiUrl = getReserveApiUrl(); // <- coloque aqui a URL do seu Worker no .env
  console.log("Reserve API URL:", apiUrl);
  console.log("");

  // JavaScript source code for Chainlink Functions
  // Busca o snapshot via seu Worker e retorna (reserveUsd_8dec, nonce)
  const sourceCode = `
// Chainlink Functions source code for Vetra reserve update
const apiUrl = args[0];

const resp = await Functions.makeHttpRequest({
  url: apiUrl,
  method: "GET",
  timeout: 20000,
  headers: {
    "Accept": "application/json, text/plain, */*",
    "User-Agent": "Mozilla/5.0 (Chainlink Functions)"
  }
});

// ---- DEBUG SEGURO ----
const hasBody = resp && typeof resp.data !== "undefined" && resp.data !== null;
let preview = "<no body>";
if (hasBody) {
  if (typeof resp.data === "string") preview = resp.data.substring(0, 200);
  else {
    try {
      const s = JSON.stringify(resp.data);
      preview = typeof s === "string" ? s.substring(0, 200) : "<unserializable>";
    } catch {
      preview = "<unserializable>";
    }
  }
}
console.log("HTTP status:", (resp && typeof resp.status === "number") ? resp.status : "n/a");
console.log("statusText:", (resp && resp.statusText) ? String(resp.statusText) : "n/a");
console.log("resp.error:", (resp && typeof resp.error !== "undefined") ? String(resp.error) : "n/a");
console.log("Body preview:", preview);

// Falha se erro de rede ou status não-2xx
if (!resp || resp.error || (typeof resp.status === "number" && (resp.status < 200 || resp.status >= 300))) {
  throw Error("HTTP error status=" + (resp ? resp.status : "n/a") + " err=" + (resp ? resp.error : "n/a"));
}

// Corpo obrigatório
if (!hasBody) throw Error("Empty response body");

// Parse objeto/JSON string
const raw = resp.data;
const data = (typeof raw === "object") ? raw : JSON.parse(raw);

// Espera { StatementSummary: { TotalBalance: "100000000.00", ... } }
const snap = data && data.StatementSummary ? data.StatementSummary : null;
if (!snap) throw Error("Missing StatementSummary");

const totalStr = String(snap.TotalBalance != null ? snap.TotalBalance : "").replace(/,/g, "");
const usd = Number(totalStr);
if (!Number.isFinite(usd) || usd < 0) throw Error("Invalid TotalBalance: " + snap.TotalBalance);

// ---- Escala para 8 casas ----
const scaled = BigInt(Math.round(usd * 1e8));
// ---- Nonce monotônico ----
const nonce  = BigInt(Date.now());

// ---------- ABI ENCODE MANUAL p/ (uint256, uint256) ----------
// abi.encode para tipos estáticos é 32 bytes por valor (big-endian, left-padded com zeros).
function toBytes32BE(x) {
  let hex = x.toString(16);
  if (hex.length % 2) hex = "0" + hex;                 // número par de dígitos
  const raw = Uint8Array.from(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
  const out = new Uint8Array(32);
  out.set(raw, 32 - raw.length);                       // left-pad com zeros
  return out;
}

const a = toBytes32BE(scaled);
const b = toBytes32BE(nonce);
const encoded = new Uint8Array(64);
encoded.set(a, 0);
encoded.set(b, 32);
// ------------------------------------------------------------

return encoded;
  `.trim();

  console.log("Chainlink Functions Source Code:");
  console.log("-----------------------------------");
  console.log(sourceCode);
  console.log("-----------------------------------\n");

  const args = [apiUrl]; // só a URL do Worker

  console.log("Requesting reserve update...");
  console.log("");

  try {
    // Request reserve update
    const tx = await vetra.requestReserveUpdate(sourceCode, args);
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

    const reserveUpdateEvent = events?.find(
      (e: any) => e?.name === "ReserveUpdateRequested"
    );

    if (reserveUpdateEvent) {
      const requestId = reserveUpdateEvent.args[0];
      const requester = reserveUpdateEvent.args[1];
      const timestamp = reserveUpdateEvent.args[2];

      console.log("\n✅ Reserve update requested:");
      console.log("- Request ID:", requestId);
      console.log("- Requester:", requester);
      console.log("- Timestamp:", new Date(Number(timestamp) * 1000).toISOString());
      console.log("");
      console.log("⏳ Waiting for Chainlink Functions to fulfill the request...");
      console.log(
        "   This may take 1-2 minutes. Monitor events with: npm run monitor:" +
          networkName
      );
      console.log("");
      console.log("   Request ID to watch:", requestId);
    }

    console.log("\n========================================");
    console.log("RESERVE UPDATE SUMMARY");
    console.log("========================================");
    console.log("Status: Request submitted ✅");
    console.log("Transaction:", tx.hash);
    console.log("Network:", networkName);
    console.log("========================================\n");
  } catch (error: any) {
    console.error("\n❌ Error requesting reserve update:");
    console.error(error.message);

    if (error.data) {
      console.error("Error data:", error.data);
    }

    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
