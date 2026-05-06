// src/test.js
// Run this to verify both functions work: npm test

import { generateExplanation, generatePrediction } from "./promptEngine.js";

// Test yield data — simulates a USDY yield drop
const fakeYieldData = {
  usdyCurrentAPY: 3.55,
  usdyPreviousAPY: 3.71,
  methCurrentAPR: 1.63,
  methPreviousAPR: 2.10,
  tbillRate: 4.25,
  recentTbillTrend: "falling",
  recentMethTrend: "stable",
  triggerAsset: "USDY",
  changePercent: -0.38,
};

// Test user — Tier 2 (Propose and Confirm)
const fakeUser = {
  userPositionUSD: 4200,
  userTier: "Propose and Confirm",
  priorDecisions: "Approved 2 similar USDY to mETH shifts in Q1 2026",
  agentAccuracy: "73% accurate over 24 predictions",
};

async function runTest() {
  console.log("\n========================================");
  console.log("RWAI PROMPT ENGINE TEST");
  console.log("========================================\n");

  console.log("TEST 1 — EXPLANATION ENGINE");
  console.log("(This is what gets sent to the user on Telegram)\n");
  const explanation = await generateExplanation(fakeYieldData, fakeUser);
  console.log(explanation);

  console.log("\n----------------------------------------\n");

  console.log("TEST 2 — PREDICTION ENGINE");
  console.log("(This JSON gets logged on-chain via ERC-8004)\n");
  const prediction = await generatePrediction(fakeYieldData);
  console.log(JSON.stringify(prediction, null, 2));

  console.log("\n========================================");
  console.log("RWAI brain is working. Ship it.");
  console.log("========================================\n");
}

runTest().catch(console.error);
