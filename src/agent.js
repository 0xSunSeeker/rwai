// src/agent.js
// The autonomous loop — runs every 30 minutes, fetches yield data, detects
// changes, generates explanations and predictions, and logs everything.

import cron from "node-cron";
import dotenv from "dotenv";
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "fs";
import { fetchAllYieldData } from "./dataFetcher.js";
import { generateExplanation, generatePrediction } from "./promptEngine.js";
dotenv.config();

// ─── PATHS ────────────────────────────────────────────────────────────────────
const DATA_DIR = "./data";
const LAST_YIELD_PATH = `${DATA_DIR}/lastYield.json`;
const PENDING_ALERT_PATH = `${DATA_DIR}/pendingAlert.json`;
const PREDICTIONS_PATH = `${DATA_DIR}/predictions.jsonl`;

// Ensure data directory exists
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

// ─── STATE ────────────────────────────────────────────────────────────────────
// Load previous snapshot from disk so state survives restarts.
let previousSnapshot = null;
if (existsSync(LAST_YIELD_PATH)) {
  try {
    previousSnapshot = JSON.parse(readFileSync(LAST_YIELD_PATH, "utf8"));
    console.log("Loaded previous snapshot from disk.");
  } catch {
    console.warn("Could not parse lastYield.json — starting fresh.");
  }
}

// How much yield needs to change before the agent triggers an alert (in %).
const ALERT_THRESHOLD = 0.10;

// ─── USER PROFILE ─────────────────────────────────────────────────────────────
const PROFILE_PATH = `${DATA_DIR}/userProfile.json`;

const DEFAULT_USER = {
  userPositionUSD: 4200,
  userTier: "Propose and Confirm",
  tierCode: 2,
  priorDecisions: "Approved 2 similar USDY→mETH shifts in Q1 2026",
  agentAccuracy: "building track record...",
};

function loadUser() {
  if (existsSync(PROFILE_PATH)) {
    try { return { ...DEFAULT_USER, ...JSON.parse(readFileSync(PROFILE_PATH, "utf8")) }; } catch {}
  }
  return { ...DEFAULT_USER };
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function hasPendingUnsentAlert() {
  if (!existsSync(PENDING_ALERT_PATH)) return false;
  try {
    const alert = JSON.parse(readFileSync(PENDING_ALERT_PATH, "utf8"));
    return alert.sent === false;
  } catch {
    return false;
  }
}

function writePendingAlert(explanation, prediction, yieldData) {
  const alert = {
    explanation,
    prediction,
    yieldData,
    generatedAt: new Date().toISOString(),
    sent: false,
  };
  writeFileSync(PENDING_ALERT_PATH, JSON.stringify(alert, null, 2));
  console.log("Pending alert written to disk.");
}

function appendPrediction(prediction) {
  const entry = { ...prediction, loggedAt: new Date().toISOString() };
  appendFileSync(PREDICTIONS_PATH, JSON.stringify(entry) + "\n");
}

// ─── CORE LOOP FUNCTION ───────────────────────────────────────────────────────
async function runAgentLoop() {
  console.log(`\n[${new Date().toISOString()}] Agent loop running...`);

  try {
    // Step 1 — Fetch live yield data
    const yieldData = await fetchAllYieldData(previousSnapshot);
    console.log(`USDY: ${yieldData.usdyCurrentAPY}% | mETH: ${yieldData.methCurrentAPR}% | T-bill: ${yieldData.tbillRate}%`);

    // Step 2 — Always generate and log a prediction (builds track record)
    const prediction = await generatePrediction(yieldData);
    appendPrediction(prediction);
    console.log("Prediction logged:", JSON.stringify(prediction, null, 2));

    // Step 3 — Check if yield moved enough to alert the user
    const user = loadUser();
    const usdyChange = Math.abs(yieldData.usdyCurrentAPY - yieldData.usdyPreviousAPY);
    const methChange = Math.abs(yieldData.methCurrentAPR - yieldData.methPreviousAPR);
    const significantChange = usdyChange > ALERT_THRESHOLD || methChange > ALERT_THRESHOLD;

    console.log(`Delegation tier: ${user.userTier}`);

    if (significantChange) {
      console.log(`Significant change detected — generating explanation...`);

      // Step 4 — Generate plain-English explanation
      const explanation = await generateExplanation(yieldData, user);
      console.log("\n=== ALERT ===");
      console.log(explanation);
      console.log("=============\n");

      // Tier 1 (Watch Only): log but don't write a pending action alert
      if (user.tierCode === 1) {
        console.log("Tier 1 active — alert logged, no action proposed.");
      } else if (!hasPendingUnsentAlert()) {
        // Tier 2: write pendingAlert.json for bot to pick up and send
        writePendingAlert(explanation, prediction, yieldData);
      } else {
        console.log("Previous alert still unsent — skipping overwrite.");
      }
    } else {
      console.log(`No significant change (USDY Δ${usdyChange.toFixed(3)}% | mETH Δ${methChange.toFixed(3)}%). Watching...`);
    }

    // Step 6 — Persist snapshot for next cycle
    previousSnapshot = yieldData;
    writeFileSync(LAST_YIELD_PATH, JSON.stringify(yieldData, null, 2));

  } catch (err) {
    console.error("Agent loop error:", err.message);
    // Loop continues even on error — agent never goes silent
  }
}

// ─── SCHEDULER ────────────────────────────────────────────────────────────────
console.log("RWAI Agent starting...");
console.log(`Alert threshold: ±${ALERT_THRESHOLD}% yield change`);
console.log("First run executing now. Then every 30 minutes.\n");

runAgentLoop();
cron.schedule("*/30 * * * *", runAgentLoop);
