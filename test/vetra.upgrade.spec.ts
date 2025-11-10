import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { Vetra, VetraV2 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("Vetra - Upgradeability", function () {
  let vetra: Vetra;
  let vetraV2: VetraV2;
  let admin: SignerWithAddress;
  let minter: SignerWithAddress;
  let burner: SignerWithAddress;
  let user: SignerWithAddress;
  let attacker: SignerWithAddress;
  let functionsRouter: SignerWithAddress;

  const RESERVE_TTL = 900;
  const DON_ID = ethers.encodeBytes32String("fun-polygon-amoy-1");
  const SUBSCRIPTION_ID = 1;
  const GAS_LIMIT = 300000;

  beforeEach(async function () {
    [admin, minter, burner, user, attacker, functionsRouter] =
      await ethers.getSigners();

    // Deploy V1
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

  describe("Upgrade Authorization", function () {
    it("Should allow admin to upgrade", async function () {
      const VetraV2Factory = await ethers.getContractFactory("VetraV2");
      const proxyAddress = await vetra.getAddress();

      // Upgrade should succeed
      vetraV2 = (await upgrades.upgradeProxy(
        proxyAddress,
        VetraV2Factory
      )) as unknown as VetraV2;

      expect(await vetraV2.getAddress()).to.equal(proxyAddress);
    });

    it("Should NOT allow non-admin to upgrade", async function () {
      // Non-admin cannot call upgradeToAndCall directly
      const VetraV2Factory = await ethers.getContractFactory("VetraV2");
      const v2Implementation = await VetraV2Factory.deploy();
      await v2Implementation.waitForDeployment();

      const v2Address = await v2Implementation.getAddress();

      await expect(
        vetra.connect(attacker).upgradeToAndCall(v2Address, "0x")
      ).to.be.reverted;
    });
  });

  describe("State Preservation", function () {
    it("Should preserve roles after upgrade", async function () {
      const DEFAULT_ADMIN_ROLE = await vetra.DEFAULT_ADMIN_ROLE();
      const MINTER_ROLE = await vetra.MINTER_ROLE();
      const BURNER_ROLE = await vetra.BURNER_ROLE();

      // Upgrade
      const VetraV2Factory = await ethers.getContractFactory("VetraV2");
      const proxyAddress = await vetra.getAddress();
      vetraV2 = (await upgrades.upgradeProxy(
        proxyAddress,
        VetraV2Factory
      )) as unknown as VetraV2;

      // Check roles are preserved
      expect(await vetraV2.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be
        .true;
      expect(await vetraV2.hasRole(MINTER_ROLE, minter.address)).to.be.true;
      expect(await vetraV2.hasRole(BURNER_ROLE, burner.address)).to.be.true;
    });

    it("Should preserve configuration after upgrade", async function () {
      // Upgrade
      const VetraV2Factory = await ethers.getContractFactory("VetraV2");
      const proxyAddress = await vetra.getAddress();
      vetraV2 = (await upgrades.upgradeProxy(
        proxyAddress,
        VetraV2Factory
      )) as unknown as VetraV2;

      // Check config is preserved
      expect(await vetraV2.reserveTTL()).to.equal(RESERVE_TTL);
      expect(await vetraV2.functionsRouter()).to.equal(functionsRouter.address);
      expect(await vetraV2.donId()).to.equal(DON_ID);
      expect(await vetraV2.subscriptionId()).to.equal(SUBSCRIPTION_ID);
    });

    it("Should preserve token metadata after upgrade", async function () {
      // Upgrade
      const VetraV2Factory = await ethers.getContractFactory("VetraV2");
      const proxyAddress = await vetra.getAddress();
      vetraV2 = (await upgrades.upgradeProxy(
        proxyAddress,
        VetraV2Factory
      )) as unknown as VetraV2;

      // Check token metadata is preserved
      expect(await vetraV2.name()).to.equal("Vetra");
      expect(await vetraV2.symbol()).to.equal("VTR");
      expect(await vetraV2.decimals()).to.equal(18);
    });

    it("Should preserve total supply after upgrade", async function () {
      const initialSupply = await vetra.totalSupply();

      // Upgrade
      const VetraV2Factory = await ethers.getContractFactory("VetraV2");
      const proxyAddress = await vetra.getAddress();
      vetraV2 = (await upgrades.upgradeProxy(
        proxyAddress,
        VetraV2Factory
      )) as unknown as VetraV2;

      expect(await vetraV2.totalSupply()).to.equal(initialSupply);
    });
  });

  describe("New Functionality", function () {
    beforeEach(async function () {
      // Upgrade to V2
      const VetraV2Factory = await ethers.getContractFactory("VetraV2");
      const proxyAddress = await vetra.getAddress();
      vetraV2 = (await upgrades.upgradeProxy(
        proxyAddress,
        VetraV2Factory
      )) as unknown as VetraV2;
    });

    it("Should have new V2 functions available", async function () {
      const message = await vetraV2.testUpgrade();
      expect(message).to.equal("Upgrade successful - VetraV2");
    });

    it("Should allow initializing V2 features", async function () {
      await vetraV2.connect(admin).initializeV2();
      const version = await vetraV2.getVersion();
      expect(version).to.equal("2.0.0");
    });

    it("Should NOT allow re-initializing V2", async function () {
      await vetraV2.connect(admin).initializeV2();
      await expect(vetraV2.connect(admin).initializeV2()).to.be.reverted;
    });
  });

  describe("Proxy Address Consistency", function () {
    it("Should maintain same proxy address after upgrade", async function () {
      const v1Address = await vetra.getAddress();

      const VetraV2Factory = await ethers.getContractFactory("VetraV2");
      vetraV2 = (await upgrades.upgradeProxy(
        v1Address,
        VetraV2Factory
      )) as unknown as VetraV2;

      const v2Address = await vetraV2.getAddress();

      expect(v2Address).to.equal(v1Address);
    });

    it("Should change implementation address after upgrade", async function () {
      const v1Address = await vetra.getAddress();
      const v1ImplAddress = await upgrades.erc1967.getImplementationAddress(
        v1Address
      );

      const VetraV2Factory = await ethers.getContractFactory("VetraV2");
      vetraV2 = (await upgrades.upgradeProxy(
        v1Address,
        VetraV2Factory
      )) as unknown as VetraV2;

      const v2ImplAddress = await upgrades.erc1967.getImplementationAddress(
        v1Address
      );

      expect(v2ImplAddress).to.not.equal(v1ImplAddress);
    });
  });

  describe("Upgrade Event", function () {
    it("Should emit Upgraded event", async function () {
      const VetraV2Factory = await ethers.getContractFactory("VetraV2");
      const proxyAddress = await vetra.getAddress();

      // The upgrade itself happens inside the upgrades.upgradeProxy
      // We can check the event was emitted by querying past events
      await upgrades.upgradeProxy(proxyAddress, VetraV2Factory);

      // Get upgrade events
      const filter = vetra.filters.Upgraded();
      const events = await vetra.queryFilter(filter);

      expect(events.length).to.be.greaterThan(0);
    });
  });
});
