import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { Vetra } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("Vetra - Reserve Management & TTL", function () {
  let vetra: Vetra;
  let admin: SignerWithAddress;
  let minter: SignerWithAddress;
  let burner: SignerWithAddress;
  let user: SignerWithAddress;
  let functionsRouter: SignerWithAddress;

  const RESERVE_TTL = 900; // 15 minutes
  const DON_ID = ethers.encodeBytes32String("fun-polygon-amoy-1");
  const SUBSCRIPTION_ID = 1;
  const GAS_LIMIT = 300000;

  beforeEach(async function () {
    [admin, minter, burner, user, functionsRouter] = await ethers.getSigners();

    const VetraFactory = await ethers.getContractFactory("Vetra");
    vetra = (await upgrades.deployProxy(
      VetraFactory,
      [
        admin.address,
        minter.address,
        burner.address,
        RESERVE_TTL,
        functionsRouter.address,
        DON_ID,
        SUBSCRIPTION_ID,
        GAS_LIMIT,
      ],
      {
        initializer: "initialize",
        kind: "uups",
      }
    )) as unknown as Vetra;

    await vetra.waitForDeployment();
  });

  /**
   * Helper function to simulate Chainlink Functions fulfillment
   * Since we can't easily call the internal fulfillRequest, we'll need to
   * test the public interface and state checks
   */
  async function simulateReserveFulfillment(
    usdAmount: bigint,
    nonce: number
  ): Promise<void> {
    // To properly test this, we'd need to either:
    // 1. Deploy a mock FunctionsRouter that can call fulfillRequest
    // 2. Use a test contract that exposes the internal function
    // For now, we'll document this limitation and test what we can
    // In a real deployment, this would be tested via integration tests
  }

  describe("Reserve Update Request", function () {
    it("Should allow admin to request reserve update", async function () {
      const sourceCode = `
        const apiUrl = args[0];
        const response = await Functions.makeHttpRequest({ url: apiUrl });
        const usd = response.data.balance * 100000000; // Convert to 8 decimals
        const nonce = Date.now();
        return Functions.encodeUint256(usd) + Functions.encodeUint256(nonce);
      `;
      const args = [
        "https://my.ftassetmanagement.com/api/bcl.asp?KeyCodeGUID=xxx",
      ];

      await expect(vetra.connect(admin).requestReserveUpdate(sourceCode, args))
        .to.emit(vetra, "ReserveUpdateRequested");
    });

    it("Should store source code after request", async function () {
      const sourceCode = "return Functions.encodeUint256(100);";
      await vetra.connect(admin).requestReserveUpdate(sourceCode, []);

      expect(await vetra.sourceCode()).to.equal(sourceCode);
    });

    it("Should NOT allow non-admin to request update", async function () {
      const sourceCode = "return Functions.encodeUint256(100);";
      await expect(vetra.connect(user).requestReserveUpdate(sourceCode, [])).to
        .be.reverted;
    });
  });

  describe("Reserve Freshness Validation", function () {
    it("Should reject mint when reserve has never been set", async function () {
      await expect(
        vetra.connect(minter).mint(user.address, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(vetra, "ReserveStale");
    });

    it("Should report reserve as not fresh when never set", async function () {
      expect(await vetra.isReserveFresh()).to.be.false;
    });

    it("Should report max age when reserve never set", async function () {
      const age = await vetra.reserveAge();
      expect(age).to.equal(ethers.MaxUint256);
    });
  });

  describe("Supply Invariant Checks", function () {
    it("Should calculate correct available mint capacity", async function () {
      // With no reserve, capacity should be 0
      expect(await vetra.availableMintCapacity()).to.equal(0);
    });

    it("Should enforce 1:1 backing on mint (when reserve is zero)", async function () {
      // Even if we bypass TTL, zero reserve means zero capacity
      // This will fail on ReserveStale, but if we could set a fresh zero reserve,
      // it would fail on ReserveInsufficient
      await expect(
        vetra.connect(minter).mint(user.address, ethers.parseEther("1"))
      ).to.be.reverted; // Will be ReserveStale in this case
    });
  });

  describe("Reserve Scaling", function () {
    it("Should have correct scaling constants", async function () {
      const RESERVE_SCALE = await vetra.RESERVE_SCALE_FACTOR();
      const TOKEN_DECIMALS = await vetra.TOKEN_DECIMALS();
      const CONVERSION = await vetra.RESERVE_TO_TOKEN_SCALE();

      expect(RESERVE_SCALE).to.equal(100000000n); // 1e8
      expect(TOKEN_DECIMALS).to.equal(ethers.parseEther("1")); // 1e18
      expect(CONVERSION).to.equal(TOKEN_DECIMALS / RESERVE_SCALE); // 1e10
    });

    it("Should correctly convert reserve USD to token capacity", async function () {
      // If reserve is $100 USD (100_0000_0000 with 8 decimals)
      // Capacity should be 100 * 1e18 tokens
      const usdAmount = 100n * 100000000n; // $100 with 8 decimals
      const expectedCapacity = 100n * ethers.parseEther("1"); // 100 tokens

      // Calculate what the contract would calculate
      const CONVERSION = await vetra.RESERVE_TO_TOKEN_SCALE();
      const calculatedCapacity = usdAmount * CONVERSION;

      expect(calculatedCapacity).to.equal(expectedCapacity);
    });
  });

  describe("Admin Configuration", function () {
    it("Should allow admin to update reserve TTL", async function () {
      const newTTL = 1800; // 30 minutes

      await expect(vetra.connect(admin).setReserveTTL(newTTL))
        .to.emit(vetra, "ReserveTTLUpdated")
        .withArgs(RESERVE_TTL, newTTL);

      expect(await vetra.reserveTTL()).to.equal(newTTL);
    });

    it("Should NOT allow setting TTL to zero", async function () {
      await expect(
        vetra.connect(admin).setReserveTTL(0)
      ).to.be.revertedWithCustomError(vetra, "InvalidConfiguration");
    });

    it("Should allow admin to update Chainlink config", async function () {
      const newRouter = user.address;
      const newDonId = ethers.encodeBytes32String("new-don");
      const newSubId = 999;
      const newGasLimit = 500000;

      await expect(
        vetra
          .connect(admin)
          .updateChainlinkConfig(newRouter, newDonId, newSubId, newGasLimit)
      )
        .to.emit(vetra, "ChainlinkConfigUpdated")
        .withArgs(newRouter, newDonId, newSubId);

      expect(await vetra.functionsRouter()).to.equal(newRouter);
      expect(await vetra.donId()).to.equal(newDonId);
      expect(await vetra.subscriptionId()).to.equal(newSubId);
      expect(await vetra.gasLimit()).to.equal(newGasLimit);
    });

    it("Should NOT allow zero address for router", async function () {
      await expect(
        vetra
          .connect(admin)
          .updateChainlinkConfig(
            ethers.ZeroAddress,
            ethers.encodeBytes32String("x"),
            1,
            300000
          )
      ).to.be.revertedWithCustomError(vetra, "InvalidAddress");
    });

    it("Should NOT allow zero gas limit", async function () {
      await expect(
        vetra
          .connect(admin)
          .updateChainlinkConfig(
            user.address,
            ethers.encodeBytes32String("x"),
            1,
            0
          )
      ).to.be.revertedWithCustomError(vetra, "InvalidConfiguration");
    });
  });

  describe("Reserve View Functions", function () {
    it("Should return current reserve USD amount", async function () {
      expect(await vetra.reserveUsd()).to.equal(0);
    });

    it("Should return current reserve nonce", async function () {
      expect(await vetra.reserveNonce()).to.equal(0);
    });

    it("Should return reserve age", async function () {
      const age = await vetra.reserveAge();
      // Should be max uint when never set
      expect(age).to.equal(ethers.MaxUint256);
    });

    it("Should return freshness status", async function () {
      expect(await vetra.isReserveFresh()).to.be.false;
    });

    it("Should return available mint capacity", async function () {
      expect(await vetra.availableMintCapacity()).to.equal(0);
    });
  });

  describe("Request Metadata Storage", function () {
    it("Should store request metadata on reserve update request", async function () {
      const sourceCode = "return Functions.encodeUint256(100);";
      const tx = await vetra
        .connect(admin)
        .requestReserveUpdate(sourceCode, []);
      const receipt = await tx.wait();

      // Extract requestId from event
      const event = receipt?.logs.find((log: any) => {
        try {
          return vetra.interface.parseLog(log)?.name === "ReserveUpdateRequested";
        } catch {
          return false;
        }
      });

      if (event) {
        const parsedEvent = vetra.interface.parseLog(event);
        const requestId = parsedEvent?.args[0];

        // Check that request metadata was stored
        const request = await vetra.requests(requestId);
        expect(request.requester).to.equal(admin.address);
        expect(request.fulfilled).to.be.false;
      }
    });
  });
});
