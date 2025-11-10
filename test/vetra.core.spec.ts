import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { Vetra } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("Vetra - Core Functionality", function () {
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

  describe("Deployment & Initialization", function () {
    it("Should set correct token name and symbol", async function () {
      expect(await vetra.name()).to.equal("Vetra");
      expect(await vetra.symbol()).to.equal("VTR");
    });

    it("Should set correct decimals", async function () {
      expect(await vetra.decimals()).to.equal(18);
    });

    it("Should initialize with zero supply", async function () {
      expect(await vetra.totalSupply()).to.equal(0);
    });

    it("Should set correct reserve TTL", async function () {
      expect(await vetra.reserveTTL()).to.equal(RESERVE_TTL);
    });

    it("Should initialize reserve with zero values", async function () {
      expect(await vetra.lastReserveUsd()).to.equal(0);
      expect(await vetra.lastReserveTimestamp()).to.equal(0);
      expect(await vetra.lastReserveNonce()).to.equal(0);
    });

    it("Should set correct Chainlink configuration", async function () {
      expect(await vetra.functionsRouter()).to.equal(functionsRouter.address);
      expect(await vetra.donId()).to.equal(DON_ID);
      expect(await vetra.subscriptionId()).to.equal(SUBSCRIPTION_ID);
      expect(await vetra.gasLimit()).to.equal(GAS_LIMIT);
    });

    it("Should initialize with limits disabled", async function () {
      expect(await vetra.mintPerTxLimit()).to.equal(0);
      expect(await vetra.allowlistEnabled()).to.equal(false);
    });

    it("Should not be paused on deployment", async function () {
      expect(await vetra.paused()).to.be.false;
    });
  });

  describe("Reserve State Management", function () {
    it("Should report reserve as not fresh initially", async function () {
      expect(await vetra.isReserveFresh()).to.be.false;
    });

    it("Should report infinite reserve age when never set", async function () {
      const age = await vetra.reserveAge();
      expect(age).to.equal(ethers.MaxUint256);
    });

    it("Should report zero available mint capacity when reserve is zero", async function () {
      expect(await vetra.availableMintCapacity()).to.equal(0);
    });
  });

  describe("Minting - Access Control", function () {
    it("Should allow MINTER_ROLE to mint (when reserve permits)", async function () {
      await expect(
        vetra.connect(user).mint(user.address, ethers.parseEther("100"))
      ).to.be.reverted;
    });

    it("Should NOT allow non-minter to mint", async function () {
      await expect(
        vetra.connect(user).mint(user.address, ethers.parseEther("100"))
      ).to.be.reverted;
    });
  });

  describe("Minting - Reserve Freshness", function () {
    it("Should revert mint when reserve is stale", async function () {
      await expect(
        vetra.connect(minter).mint(user.address, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(vetra, "ReserveStale");
    });
  });

  describe("Burning - Access Control", function () {
    it("Should allow BURNER_ROLE to burn from an account", async function () {
      await expect(
        vetra.connect(user).burnFrom(user.address, ethers.parseEther("100"))
      ).to.be.reverted;
    });

    it("Should NOT allow non-burner to use burnFrom", async function () {
      await expect(
        vetra.connect(user).burnFrom(user.address, ethers.parseEther("100"))
      ).to.be.reverted;
    });

    it("Should allow anyone to burn their own tokens", async function () {
      await expect(vetra.connect(user).burn(ethers.parseEther("1"))).to.be
        .reverted;
    });
  });

  describe("Burning - Input Validation", function () {
    it("Should revert burnFrom with zero amount", async function () {
      await expect(
        vetra.connect(burner).burnFrom(user.address, 0)
      ).to.be.revertedWithCustomError(vetra, "InvalidAmount");
    });

    it("Should revert burnFrom with zero address", async function () {
      await expect(
        vetra.connect(burner).burnFrom(ethers.ZeroAddress, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(vetra, "InvalidAddress");
    });

    it("Should revert self-burn with zero amount", async function () {
      await expect(vetra.connect(user).burn(0)).to.be.revertedWithCustomError(
        vetra,
        "InvalidAmount"
      );
    });
  });

  describe("ERC20 Standard Functions", function () {
    it("Should return correct balanceOf for address with no tokens", async function () {
      expect(await vetra.balanceOf(user.address)).to.equal(0);
    });

    it("Should return zero total supply initially", async function () {
      expect(await vetra.totalSupply()).to.equal(0);
    });
  });

  describe("View Functions", function () {
    it("Should return reserveUsd()", async function () {
      expect(await vetra.reserveUsd()).to.equal(0);
    });

    it("Should return reserveNonce()", async function () {
      expect(await vetra.reserveNonce()).to.equal(0);
    });

    it("Should return correct constants", async function () {
      expect(await vetra.RESERVE_SCALE_FACTOR()).to.equal(100000000n); // 1e8
      expect(await vetra.TOKEN_DECIMALS()).to.equal(ethers.parseEther("1")); // 1e18
      expect(await vetra.RESERVE_TO_TOKEN_SCALE()).to.equal(10000000000n); // 1e10
    });
  });

  describe("Input Validation", function () {
    it("Should revert mint with zero address", async function () {
      await expect(
        vetra.connect(minter).mint(ethers.ZeroAddress, ethers.parseEther("100"))
      ).to.be.revertedWithCustomError(vetra, "InvalidAddress");
    });

    it("Should revert mint with zero amount", async function () {
      await expect(
        vetra.connect(minter).mint(user.address, 0)
      ).to.be.revertedWithCustomError(vetra, "InvalidAmount");
    });
  });
});
