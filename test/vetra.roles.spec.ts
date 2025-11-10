import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { Vetra } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("Vetra - Roles & Access Control", function () {
  let vetra: Vetra;
  let admin: SignerWithAddress;
  let minter: SignerWithAddress;
  let burner: SignerWithAddress;
  let user: SignerWithAddress;
  let attacker: SignerWithAddress;
  let functionsRouter: SignerWithAddress; // Mock router for testing

  const RESERVE_TTL = 900; // 15 minutes
  const DON_ID = ethers.encodeBytes32String("fun-polygon-amoy-1");
  const SUBSCRIPTION_ID = 1;
  const GAS_LIMIT = 300000;

  beforeEach(async function () {
    [admin, minter, burner, user, attacker, functionsRouter] =
      await ethers.getSigners();

    // Deploy Vetra as upgradeable proxy
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

  describe("Role Assignment", function () {
    it("Should assign DEFAULT_ADMIN_ROLE to admin", async function () {
      const DEFAULT_ADMIN_ROLE = await vetra.DEFAULT_ADMIN_ROLE();
      expect(await vetra.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
    });

    it("Should assign MINTER_ROLE to minter", async function () {
      const MINTER_ROLE = await vetra.MINTER_ROLE();
      expect(await vetra.hasRole(MINTER_ROLE, minter.address)).to.be.true;
    });

    it("Should assign BURNER_ROLE to burner", async function () {
      const BURNER_ROLE = await vetra.BURNER_ROLE();
      expect(await vetra.hasRole(BURNER_ROLE, burner.address)).to.be.true;
    });

    it("Should NOT assign any role to regular user", async function () {
      const DEFAULT_ADMIN_ROLE = await vetra.DEFAULT_ADMIN_ROLE();
      const MINTER_ROLE = await vetra.MINTER_ROLE();
      const BURNER_ROLE = await vetra.BURNER_ROLE();

      expect(await vetra.hasRole(DEFAULT_ADMIN_ROLE, user.address)).to.be.false;
      expect(await vetra.hasRole(MINTER_ROLE, user.address)).to.be.false;
      expect(await vetra.hasRole(BURNER_ROLE, user.address)).to.be.false;
    });
  });

  describe("Admin-Only Functions", function () {
    it("Should allow admin to pause", async function () {
      await expect(vetra.connect(admin).pause()).to.not.be.reverted;
      expect(await vetra.paused()).to.be.true;
    });

    it("Should NOT allow non-admin to pause", async function () {
      await expect(vetra.connect(attacker).pause()).to.be.reverted;
    });

    it("Should allow admin to unpause", async function () {
      await vetra.connect(admin).pause();
      await expect(vetra.connect(admin).unpause()).to.not.be.reverted;
      expect(await vetra.paused()).to.be.false;
    });

    it("Should NOT allow non-admin to unpause", async function () {
      await vetra.connect(admin).pause();
      await expect(vetra.connect(attacker).unpause()).to.be.reverted;
    });

    it("Should allow admin to set reserve TTL", async function () {
      const newTTL = 1800; // 30 minutes
      await expect(vetra.connect(admin).setReserveTTL(newTTL))
        .to.emit(vetra, "ReserveTTLUpdated")
        .withArgs(RESERVE_TTL, newTTL);
      expect(await vetra.reserveTTL()).to.equal(newTTL);
    });

    it("Should NOT allow non-admin to set reserve TTL", async function () {
      await expect(vetra.connect(attacker).setReserveTTL(1800)).to.be.reverted;
    });

    it("Should allow admin to set mint limit", async function () {
      const limit = ethers.parseEther("1000000"); // 1M VTR
      await expect(vetra.connect(admin).setMintPerTxLimit(limit))
        .to.emit(vetra, "MintLimitUpdated")
        .withArgs(0, limit);
      expect(await vetra.mintPerTxLimit()).to.equal(limit);
    });

    it("Should NOT allow non-admin to set mint limit", async function () {
      await expect(
        vetra.connect(attacker).setMintPerTxLimit(ethers.parseEther("1000000"))
      ).to.be.reverted;
    });

    it("Should allow admin to enable allowlist", async function () {
      await expect(vetra.connect(admin).setAllowlistEnabled(true))
        .to.emit(vetra, "AllowlistStatusUpdated")
        .withArgs(true);
      expect(await vetra.allowlistEnabled()).to.be.true;
    });

    it("Should NOT allow non-admin to enable allowlist", async function () {
      await expect(vetra.connect(attacker).setAllowlistEnabled(true)).to.be
        .reverted;
    });

    it("Should allow admin to update allowlist addresses", async function () {
      await expect(vetra.connect(admin).setAllowlistAddress(user.address, true))
        .to.emit(vetra, "AllowlistAddressUpdated")
        .withArgs(user.address, true);
      expect(await vetra.allowlist(user.address)).to.be.true;
    });

    it("Should NOT allow non-admin to update allowlist", async function () {
      await expect(
        vetra.connect(attacker).setAllowlistAddress(user.address, true)
      ).to.be.reverted;
    });

    it("Should allow admin to update Chainlink config", async function () {
      const newRouter = attacker.address; // Just for testing
      const newDonId = ethers.encodeBytes32String("new-don-id");
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

    it("Should NOT allow non-admin to update Chainlink config", async function () {
      await expect(
        vetra
          .connect(attacker)
          .updateChainlinkConfig(
            attacker.address,
            ethers.encodeBytes32String("x"),
            1,
            300000
          )
      ).to.be.reverted;
    });

    it("Should allow admin to request reserve update", async function () {
      const sourceCode = "return Functions.encodeUint256(100);";
      const args: string[] = [];

      await expect(vetra.connect(admin).requestReserveUpdate(sourceCode, args))
        .to.emit(vetra, "ReserveUpdateRequested");
    });

    it("Should NOT allow non-admin to request reserve update", async function () {
      const sourceCode = "return Functions.encodeUint256(100);";
      const args: string[] = [];

      await expect(
        vetra.connect(attacker).requestReserveUpdate(sourceCode, args)
      ).to.be.reverted;
    });
  });

  describe("Minter Role", function () {
    it("Should allow admin to grant MINTER_ROLE", async function () {
      const MINTER_ROLE = await vetra.MINTER_ROLE();
      await vetra.connect(admin).grantRole(MINTER_ROLE, user.address);
      expect(await vetra.hasRole(MINTER_ROLE, user.address)).to.be.true;
    });

    it("Should NOT allow non-admin to grant MINTER_ROLE", async function () {
      const MINTER_ROLE = await vetra.MINTER_ROLE();
      await expect(vetra.connect(attacker).grantRole(MINTER_ROLE, user.address))
        .to.be.reverted;
    });

    it("Should allow admin to revoke MINTER_ROLE", async function () {
      const MINTER_ROLE = await vetra.MINTER_ROLE();
      await vetra.connect(admin).revokeRole(MINTER_ROLE, minter.address);
      expect(await vetra.hasRole(MINTER_ROLE, minter.address)).to.be.false;
    });
  });

  describe("Burner Role", function () {
    it("Should allow admin to grant BURNER_ROLE", async function () {
      const BURNER_ROLE = await vetra.BURNER_ROLE();
      await vetra.connect(admin).grantRole(BURNER_ROLE, user.address);
      expect(await vetra.hasRole(BURNER_ROLE, user.address)).to.be.true;
    });

    it("Should NOT allow non-admin to grant BURNER_ROLE", async function () {
      const BURNER_ROLE = await vetra.BURNER_ROLE();
      await expect(vetra.connect(attacker).grantRole(BURNER_ROLE, user.address))
        .to.be.reverted;
    });

    it("Should allow admin to revoke BURNER_ROLE", async function () {
      const BURNER_ROLE = await vetra.BURNER_ROLE();
      await vetra.connect(admin).revokeRole(BURNER_ROLE, burner.address);
      expect(await vetra.hasRole(BURNER_ROLE, burner.address)).to.be.false;
    });
  });

  describe("Pausable Behavior", function () {
    it("Should prevent minting when paused", async function () {
      await vetra.connect(admin).pause();
      await expect(
        vetra.connect(minter).mint(user.address, ethers.parseEther("100"))
      ).to.be.reverted;
    });

    it("Should prevent burning when paused", async function () {
      await vetra.connect(admin).pause();
      await expect(
        vetra.connect(burner).burnFrom(user.address, ethers.parseEther("100"))
      ).to.be.reverted;
    });

    it("Should prevent self-burn when paused", async function () {
      await vetra.connect(admin).pause();
      await expect(vetra.connect(user).burn(ethers.parseEther("100"))).to.be
        .reverted;
    });
  });

  describe("Role Renunciation", function () {
    it("Should allow role holder to renounce their own role", async function () {
      const MINTER_ROLE = await vetra.MINTER_ROLE();
      await vetra.connect(minter).renounceRole(MINTER_ROLE, minter.address);
      expect(await vetra.hasRole(MINTER_ROLE, minter.address)).to.be.false;
    });

    it("Should NOT allow renouncing role for another address", async function () {
      const MINTER_ROLE = await vetra.MINTER_ROLE();
      await expect(
        vetra.connect(attacker).renounceRole(MINTER_ROLE, minter.address)
      ).to.be.reverted;
    });
  });
});
