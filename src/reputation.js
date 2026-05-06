import { ethers } from 'ethers';
import dotenv from 'dotenv';
dotenv.config();

// MANTLE MAINNET CONFIG
const REGISTRY_ADDRESS = "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63"; 
const MANTLE_RPC = "https://rpc.mantle.xyz";

// Standard ERC-8004 Reputation ABI
const REGISTRY_ABI = [
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string calldata tag1, string calldata tag2, string calldata endpoint, string calldata feedbackURI, bytes32 filehash) external"
];

export async function logDecision(yieldSpread, recommendation) {
  try {
    const provider = new ethers.JsonRpcProvider(MANTLE_RPC);
    const wallet = new ethers.Wallet(process.env.MANTLE_PRIVATE_KEY, provider);
    const registry = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, wallet);

    // 1. Evidence Hash
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes(recommendation));

    // 2. Format Score for giveFeedback (1.56% -> 156 with 2 decimals)
    const scoreValue = Math.round(Math.abs(Number(yieldSpread)) * 100);

    console.log(`📡 Anchoring thought to Mantle...`);

    const tx = await registry.giveFeedback(
      1,                        // Your Agent ID
      scoreValue,               // The numeric signal
      2,                        // Decimals (e.g., 1.56)
      "yield-analysis",         // Primary tag
      "rwa",                    // Secondary tag
      "telegram-bot",           // Endpoint type
      "https://havenfi.xyz",    // Metadata URI
      evidenceHash              // The cryptographic proof
    );

    const receipt = await tx.wait();
    console.log(`✅ Success! Tx: ${receipt.hash}`);
    
    return {
      txHash: receipt.hash,
      explorerUrl: `https://explorer.mantle.xyz/tx/${receipt.hash}`
    };
  } catch (err) {
    console.error("Reputation Error:", err.message);
    return null;
  }
}