# VETRA

**1:1 USD-backed stablecoin with Chainlink Functions proof-of-reserves**

Vetra (VTR) is an upgradeable ERC-20 stablecoin designed to maintain 1:1 USD backing based on reserves held by FT Asset Management KB. The contract uses Chainlink Functions to fetch and verify reserve balances on-chain and applies a minting policy so that totalSupply() does not exceed the most recent reported reserves.

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Configuration](#configuration)
- [Usage](#usage)
- [Testing](#testing)
- [Contract Details](#contract-details)
- [Security](#security)
- [License](#license)

## Features

### Core Functionality
- **ERC-20 Standard**: Fully compliant ERC-20 token with 18 decimals
- **1:1 USD Backing**: Every VTR token is backed by $1 USD in reserves
- **UUPS Upgradeable**: Secure upgradeability pattern via UUPSUpgradeable
- **Role-Based Access Control**: Separate roles for admins, minters, and burners
- **Pausable**: Emergency pause mechanism for critical situations

### Reserve Management
- **Chainlink Functions Integration**: Automated reserve updates via decentralized oracle network
- **Reserve Freshness**: 15-minute TTL ensures recent reserve data
- **Monotonic Nonce**: Prevents replay attacks and ensures reserve update ordering
- **Supply Invariant**: Enforces `totalSupply() <= reserves` at all times

### Safety Features
- **Optional Per-Transaction Mint Limit**: Configurable maximum mint amount
- **Optional Allowlist**: Restrict minting to approved addresses
- **Event Emission**: Comprehensive events for all critical operations
- **Input Validation**: Zero-address and zero-amount checks

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                         Vetra Contract                        │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐ │
│  │  ERC20         │  │  UUPS          │  │  AccessControl │ │
│  │  Upgradeable   │  │  Upgradeable   │  │  Upgradeable   │ │
│  └────────────────┘  └────────────────┘  └────────────────┘ │
│                                                                │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐ │
│  │  Pausable      │  │  Reserve       │  │  Chainlink     │ │
│  │  Upgradeable   │  │  Management    │  │  Functions     │ │
│  └────────────────┘  └────────────────┘  └────────────────┘ │
└──────────────────────────────────────────────────────────────┘
                              ▲
                              │
                              │ Reserve Updates
                              │
                   ┌──────────┴──────────┐
                   │  Chainlink Functions │
                   │      Network         │
                   └──────────┬──────────┘
                              │
                              │ HTTP Request
                              │
                   ┌──────────▼──────────┐
                   │  FT Asset Management │
                   │    Reserve API       │
                   └─────────────────────┘
```

## Tech Stack

- **Solidity**: ^0.8.24
- **Hardhat**: Smart contract development environment
- **OpenZeppelin**: Upgradeable contracts v5.4.0
- **Chainlink**: Functions v1.5.0
- **TypeScript**: Type-safe scripts and tests
- **Ethers.js**: v6.x for blockchain interactions

## Configuration

### Reserve Scaling Math

The contract uses **8-decimal precision for USD** and **18-decimal precision for tokens**:

- **Reserve API**: Returns USD balance (e.g., `100.00` USD)
- **Contract Storage**: `lastReserveUsd` = USD × 10^8 (e.g., `10000000000` for $100)
- **Token Amount**: VTR = USD × 10^18 (e.g., `100000000000000000000` for 100 VTR)

**Conversion Formula**:
```
tokenAmount = reserveUsd × (10^18 / 10^8)
tokenAmount = reserveUsd × 10^10
```

**Example**:
- Reserve = $1,000,000 USD
- Stored as: `100000000000000` (8 decimals)
- Max mintable: `1000000000000000000000000` (1M tokens with 18 decimals)

## Usage

### Minting Tokens

Only addresses with `MINTER_ROLE` can mint:

```solidity
// Requires:
// 1. Fresh reserve (within TTL)
// 2. Sufficient reserve backing
// 3. Contract not paused
vetra.mint(recipientAddress, amount);
```

### Burning Tokens

**Operator Burn** (BURNER_ROLE):
```solidity
vetra.burnFrom(accountAddress, amount);
```

**Self-Burn** (anyone):
```solidity
vetra.burn(amount);
```

### Monitoring

Real-time event monitoring:
```bash
npm run monitor:amoy
# or
npm run monitor:polygon
```

Shows:
- TokensMinted / TokensBurned events
- Reserve updates
- Configuration changes
- Current contract state

### Administrative Functions

Only `DEFAULT_ADMIN_ROLE`:

```solidity
// Pause/unpause
vetra.pause();
vetra.unpause();

// Update reserve TTL
vetra.setReserveTTL(newTTLSeconds);

// Set mint limit
vetra.setMintPerTxLimit(limitAmount);

// Enable/disable allowlist
vetra.setAllowlistEnabled(true);
vetra.setAllowlistAddress(address, allowed);

// Update Chainlink config
vetra.updateChainlinkConfig(router, donId, subId, gasLimit);

// Upgrade contract
vetra.upgradeToAndCall(newImplementation, data);
```

## Testing

### Run All Tests
```bash
npm test
```

### Test Suites

1. **vetra.roles.spec.ts** (35 tests)
   - Role assignment and verification
   - Admin-only functions
   - Pausable behavior

2. **vetra.core.spec.ts** (22 tests)
   - ERC-20 functionality
   - Minting/burning access control
   - Input validation

3. **vetra.reserve.spec.ts** (22 tests)
   - Reserve management
   - TTL enforcement
   - Scaling and conversions

4. **vetra.upgrade.spec.ts** (12 tests)
   - UUPS upgradeability
   - State preservation
   - Authorization

### Coverage
```bash
npm run test:coverage
```

## Contract Details

### Vetra.sol

**Address:** See `0x34514180F94903BF8649884bD7e80fcDC1048b9d`

#### Roles
- `DEFAULT_ADMIN_ROLE`: Governance (upgrades, config, pause)
- `MINTER_ROLE`: Can mint tokens (respecting reserve limits)
- `BURNER_ROLE`: Can burn from any account

#### State Variables
```solidity
uint256 public lastReserveUsd;        // USD reserve (8 decimals)
uint256 public lastReserveTimestamp;  // Last update timestamp
uint256 public lastReserveNonce;      // Monotonic nonce
uint256 public reserveTTL;            // Freshness requirement (900s)
uint256 public mintPerTxLimit;        // Optional per-tx limit
bool public allowlistEnabled;         // Optional allowlist toggle
```

#### Events
```solidity
event TokensMinted(address indexed to, uint256 amount, address indexed operator,
                   uint256 totalSupplyAfter, uint256 reserveAfter, uint256 timestamp);
event TokensBurned(address indexed from, uint256 amount, address indexed operator,
                   uint256 totalSupplyAfter, uint256 timestamp);
event ReserveUpdateRequested(bytes32 indexed requestId, address indexed requester,
                              uint256 timestamp);
event ReserveUpdated(uint256 usdAmount, uint256 nonce, uint256 timestamp,
                     bytes32 indexed requestId);
```

## Security

### Audit Status
⚠️ **Independent security audit is planned prior to any public launch.** This code is provided for testing and evaluation purposes and **is not intended for production use**.

### Security Features
- UUPS upgrade pattern (only admin)
- Role-based access control
- Reserve freshness checks
- Nonce monotonicity
- Pausable emergency stop
- Input validation
- No hardcoded addresses

## Scripts

| Command | Description |
|---------|-------------|
| `npm run compile` | Compile contracts |
| `npm test` | Run all tests |
| `npm run test:coverage` | Generate coverage report |
| `npm run deploy:amoy` | Deploy to Amoy testnet |
| `npm run deploy:polygon` | Deploy to Polygon mainnet |
| `npm run verify:amoy` | Verify on Amoy Polygonscan |
| `npm run verify:polygon` | Verify on Polygonscan |
| `npm run update-reserve:amoy` | Update reserve on Amoy |
| `npm run update-reserve:polygon` | Update reserve on Polygon |
| `npm run monitor:amoy` | Monitor Amoy events |
| `npm run monitor:polygon` | Monitor Polygon events |
| `npm run clean` | Clean artifacts |

## Deployment Addresses

### Polygon Amoy Testnet
- Proxy: `0x787891862A4A7314D98e5EE982c3af7CEf4A2982`
- Implementation: `0xaBC8A4adD4B98ee341faF7DF2564A8d4498DB04F`

### Polygon Mainnet
- Proxy: `0x34514180F94903BF8649884bD7e80fcDC1048b9d`
- Implementation: `0xBF109daaf6547c47987144eD1c58626f6ab3bD8F`

## License

MIT License - see [LICENSE](./LICENSE) file for details

## Support

For issues and questions:
- Email: **contactvtrcoin@gmail.com**
- X (Twitter): **https://x.com/vetravtr?s=11**
- Documentation: This README
- Chainlink Docs: https://docs.chain.link/chainlink-functions

**Security & responsible disclosure:** please report vulnerabilities privately to **contactvtrcoin@gmail.com**.

---

**Built with Chainlink Functions on Polygon**
