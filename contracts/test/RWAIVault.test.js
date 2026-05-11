const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RWAIVault", function () {
  let vault, owner, agent, user, mockRouter, mockRegistry;

  beforeEach(async function () {
    [owner, agent, user] = await ethers.getSigners();
    const Mock = await ethers.getContractFactory("MockTarget");
    mockRouter = await Mock.deploy();
    mockRegistry = await Mock.deploy();
    const Vault = await ethers.getContractFactory("RWAIVault");
    vault = await Vault.deploy(
      await mockRouter.getAddress(),
      await mockRegistry.getAddress(),
      agent.address
    );
  });

  it("sets USDY address correctly", async function () {
    expect(await vault.USDY()).to.equal("0x5bE26527e817998A7206475496fDE1E68957c5A6");
  });

  it("sets DEFAULT_CAP to 500e18", async function () {
    expect(await vault.DEFAULT_CAP()).to.equal(ethers.parseUnits("500", 18));
  });

  it("sets agent address on deploy", async function () {
    expect(await vault.agentAddress()).to.equal(agent.address);
  });

  it("owner can add a supported token", async function () {
    const fakeToken = "0x1111111111111111111111111111111111111111";
    await vault.connect(owner).addSupportedToken(fakeToken);
    expect(await vault.isSupported(fakeToken)).to.equal(true);
  });

  it("non-agent cannot call executeSwap", async function () {
    const fakeToken = "0x1111111111111111111111111111111111111111";
    const fakeToken2 = "0x2222222222222222222222222222222222222222";
    await expect(
      vault.connect(user).executeSwap(
        user.address, fakeToken, fakeToken2,
        ethers.parseUnits("1", 18), 0, ethers.ZeroHash, []
      )
    ).to.be.revertedWith("RWAIVault: not agent");
  });
});
