import * as dotenv from "dotenv";
import { HardhatUserConfig } from "hardhat/config";

// Load environment variables
dotenv.config();

// Environment mode
export const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PRODUCTION = NODE_ENV === "production";

// Determine network prefix
const PREFIX = IS_PRODUCTION ? "POLYGON" : "AMOY";

// Helper to get env variable with prefix
function getEnv(key: string, fallback?: string): string {
  const value = process.env[`${PREFIX}_${key}`] || fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${PREFIX}_${key}`);
  }
  return value;
}

// Helper to get optional env variable with prefix
function getOptionalEnv(key: string, fallback?: string): string | undefined {
  return process.env[`${PREFIX}_${key}`] || fallback;
}

// Core Configuration
export function getPrivateKey(): string {
  const key = process.env.PRIVATE_KEY_DEV;
  if (!key) {
    throw new Error("PRIVATE_KEY_DEV is required");
  }
  return key;
}

export function getPolygonscanApiKey(): string {
  return process.env.POLYGONSCAN_API_KEY || "";
}

// Network Configuration
export function getRpcUrl(): string {
  return getEnv("RPC_URL");
}

export function getChainId(): number {
  return parseInt(getEnv("CHAIN_ID"));
}

// Chainlink Functions Configuration
export function getLinkToken(): string {
  return getEnv("LINK_TOKEN");
}

export function getFunctionsRouter(): string {
  return getEnv("FUNCTIONS_ROUTER");
}

export function getDonId(): string {
  return getEnv("DON_ID");
}

export function getSubscriptionId(): string {
  return getOptionalEnv("SUBSCRIPTION_ID", "0") || "0";
}

// Role Addresses
export function getAdminAddress(): string {
  return getEnv("ADMIN_ADDRESS");
}

export function getMinterAddress(): string {
  return getEnv("MINTER_ADDRESS");
}

export function getBurnerAddress(): string {
  return getEnv("BURNER_ADDRESS");
}

// Reserve Configuration
export function getReserveApiUrl(): string {
  const url = process.env.RESERVE_API_URL;
  if (!url) {
    throw new Error("RESERVE_API_URL is required");
  }
  return url;
}

export function getReserveUpdateInterval(): number {
  return parseInt(process.env.RESERVE_UPDATE_INTERVAL_SECONDS || "300");
}

export function getReserveTTL(): number {
  return parseInt(process.env.RESERVE_TTL_SECONDS || "900");
}

// Policy Configuration
export function getMintPerTxLimit(): string {
  return process.env.MINT_PER_TX_LIMIT || "0";
}

export function isAllowlistEnabled(): boolean {
  return process.env.ALLOWLIST_ENABLED === "true";
}

// Network Name
export function getNetworkName(): string {
  return IS_PRODUCTION ? "polygon" : "amoy";
}

// Display current config (for debugging)
export function displayConfig(): void {
  console.log("\n=================================");
  console.log(`VETRA STABLECOIN CONFIGURATION`);
  console.log("=================================");
  console.log(`Environment: ${NODE_ENV}`);
  console.log(`Network: ${getNetworkName()}`);
  console.log(`Chain ID: ${getChainId()}`);
  console.log(`RPC URL: ${getRpcUrl()}`);
  console.log(`Admin: ${getAdminAddress()}`);
  console.log(`Minter: ${getMinterAddress()}`);
  console.log(`Burner: ${getBurnerAddress()}`);
  console.log(`LINK Token: ${getLinkToken()}`);
  console.log(`Functions Router: ${getFunctionsRouter()}`);
  console.log(`Reserve TTL: ${getReserveTTL()}s`);
  console.log(`Update Interval: ${getReserveUpdateInterval()}s`);
  console.log("=================================\n");
}

// Export network configuration for Hardhat
export function getNetworkConfig(): HardhatUserConfig["networks"] {
  return {
    hardhat: {
      chainId: 31337,
    },
    amoy: {
      url: process.env.AMOY_RPC_URL || "https://rpc-amoy.polygon.technology",
      chainId: parseInt(process.env.AMOY_CHAIN_ID || "80002"),
      accounts: process.env.PRIVATE_KEY_DEV ? [process.env.PRIVATE_KEY_DEV] : [],
    },
    polygon: {
      url: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
      chainId: parseInt(process.env.POLYGON_CHAIN_ID || "137"),
      accounts: process.env.PRIVATE_KEY_DEV ? [process.env.PRIVATE_KEY_DEV] : [],
    },
  };
}
