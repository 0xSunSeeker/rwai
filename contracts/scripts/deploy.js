const { ethers, network } = require("hardhat");
require("dotenv").config({ path: "../.env" });

const ROUTER   = "0xeaEE7EE68874218c3558b40063c42B82D3E7232a"; // MoeRouter
const REGISTRY = "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63"; // ERC-8004

async function main() {
  const [deployer] = await ethers.getSigners();

  // Agent defaults to the deployer if AGENT_ADDRESS is not set in .env
  const agentAddress = process.env.AGENT_ADDRESS || deployer.address;

  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("─────────────────────────────────────────");
  console.log("  RWAI Vault Deployment");
  console.log("─────────────────────────────────────────");
  console.log(`  Network:  ${network.name}`);
  console.log(`  Deployer: ${deployer.address}`);
  console.log(`  Agent:    ${agentAddress}`);
  console.log(`  Balance:  ${ethers.formatEther(balance)} MNT`);
  console.log(`  Router:   ${ROUTER}`);
  console.log(`  Registry: ${REGISTRY}`);
  console.log("─────────────────────────────────────────\n");

  if (balance === 0n) {
    throw new Error("Deployer has zero MNT balance — fund the wallet before deploying.");
  }

  const RWAIVault = await ethers.getContractFactory("RWAIVault");
  console.log("Deploying RWAIVault...");

  const vault = await RWAIVault.deploy(ROUTER, REGISTRY, agentAddress);
  await vault.waitForDeployment();

  const address = await vault.getAddress();

  const explorerBase =
    network.name === "mantleSepolia"
      ? "https://sepolia.mantlescan.xyz"
      : "https://mantlescan.xyz";

  console.log(`\n✅ RWAIVault deployed to: ${address}`);
  console.log(`   Explorer: ${explorerBase}/address/${address}\n`);

  console.log("Supported tokens seeded in constructor:");
  console.log("  USDY  0x5bE26527e817998173a93d9E59a6a78b0ffbf32C");
  console.log("  mETH  0xcDA86A272531e8640cD7F1a92c01839911B90bb0");
  console.log("  cmETH 0xE6829d9a7eE3040e1276Fa75293Bde931859e8fA\n");

  console.log("To verify on explorer, run:");
  console.log(
    `  npx hardhat verify --network ${network.name} ${address} "${ROUTER}" "${REGISTRY}" "${agentAddress}"\n`
  );

  console.log("Next step — add VAULT_ADDRESS to your .env:");
  console.log(`  VAULT_ADDRESS=${address}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
