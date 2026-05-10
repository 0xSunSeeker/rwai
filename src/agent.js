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

const SPREAD_ALERT_THRESHOLD    = 1.5;   // Send alert explaining opportunity
const SPREAD_PROPOSAL_THRESHOLD = 1.65;  // Propose specific rebalance action
const SPREAD_AUTOEXECUTE_THRESHOLD = 2.0; // Tier 3 auto-execute (future)

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

function writePendingAlert(explanation, prediction, yieldData, alertType) {
  const alert = {
    explanation,
    prediction,
    yieldData,
    alertType: alertType ?? "yield_change",
    generatedAt: new Date().toISOString(),
    sent: false,
  };
  writeFileSync(PENDING_ALERT_PATH, JSON.stringify(alert, null, 2));
  console.log("Pending alert written to disk.");
}

function appendPrediction(prediction, yieldData) {
  const entry = {
    ...prediction,
    loggedAt: new Date().toISOString(),
    yieldAtPrediction: {
      usdyAPY: yieldData.usdyCurrentAPY,
      methAPR: yieldData.methCurrentAPR,
      cmethAPY: yieldData.cmethCurrentAPY,
    },
    resolved: false,
  };
  appendFileSync(PREDICTIONS_PATH, JSON.stringify(entry) + "\n");
}

// Direction: returns "up", "down", or "stable" given a before/after pair
function toDirection(before, after, threshold = 0.05) {
  const delta = after - before;
  if (delta > threshold) return "up";
  if (delta < -threshold) return "down";
  return "stable";
}

// Reads predictions.jsonl, resolves any that are 24h+ old, rewrites the file
function resolveOldPredictions(currentYield) {
  if (!existsSync(PREDICTIONS_PATH)) return;
  try {
    const lines = readFileSync(PREDICTIONS_PATH, "utf8").trim().split("\n").filter(Boolean);
    const now = Date.now();
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    let resolved = 0;

    const updated = lines.map(line => {
      let p;
      try { p = JSON.parse(line); } catch { return line; }

      // Skip already resolved or missing yield snapshot
      if (p.resolved || !p.yieldAtPrediction) return line;

      const age = now - new Date(p.loggedAt).getTime();
      if (age < TWENTY_FOUR_HOURS) return line;

      // Determine actual direction for each asset
      const actualUsdy  = toDirection(p.yieldAtPrediction.usdyAPY,  currentYield.usdyCurrentAPY);
      const actualMeth  = toDirection(p.yieldAtPrediction.methAPR,   currentYield.methCurrentAPR);
      const actualCmeth = p.yieldAtPrediction.cmethAPY != null
        ? toDirection(p.yieldAtPrediction.cmethAPY, currentYield.cmethCurrentAPY)
        : null;

      const usdyCorrect  = p.usdyPrediction.direction  === actualUsdy;
      const methCorrect  = p.methPrediction.direction  === actualMeth;
      const cmethCorrect = actualCmeth != null && p.cmethPrediction
        ? p.cmethPrediction.direction === actualCmeth
        : null;

      resolved++;
      return JSON.stringify({
        ...p,
        resolved: true,
        resolvedAt: new Date().toISOString(),
        usdyPrediction:  { ...p.usdyPrediction,  correct: usdyCorrect,  actualDirection: actualUsdy },
        methPrediction:  { ...p.methPrediction,  correct: methCorrect,  actualDirection: actualMeth },
        ...(p.cmethPrediction && actualCmeth != null
          ? { cmethPrediction: { ...p.cmethPrediction, correct: cmethCorrect, actualDirection: actualCmeth } }
          : {}),
      });
    });

    if (resolved > 0) {
      writeFileSync(PREDICTIONS_PATH, updated.join("\n") + "\n");
      console.log(`Resolved ${resolved} prediction(s) against current yield.`);

      // Update agentAccuracy in userProfile so promptEngine uses the real number
      const allParsed = updated.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const done = allParsed.filter(p => p.resolved);
      const total = done.reduce((n, p) => n + (p.cmethPrediction ? 3 : 2), 0);
      const correct = done.reduce((n, p) =>
        n + (p.usdyPrediction.correct ? 1 : 0)
          + (p.methPrediction.correct ? 1 : 0)
          + (p.cmethPrediction?.correct ? 1 : 0), 0);
      if (total > 0 && existsSync(PROFILE_PATH)) {
        try {
          const profile = JSON.parse(readFileSync(PROFILE_PATH, "utf8"));
          profile.agentAccuracy = `${Math.round((correct / total) * 100)}% accurate over ${done.length} predictions`;
          writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2));
        } catch {}
      }
    }
  } catch (err) {
    console.warn("resolveOldPredictions error:", err.message);
  }
}

// ─── CORE LOOP FUNCTION ───────────────────────────────────────────────────────
async function runAgentLoop() {
  console.log(`\n[${new Date().toISOString()}] Agent loop running...`);

  try {
    // Step 1 — Fetch live yield data
    const yieldData = await fetchAllYieldData(previousSnapshot);
    console.log(`USDY: ${yieldData.usdyCurrentAPY}% | mETH: ${yieldData.methCurrentAPR}% | cmETH: ${yieldData.cmethCurrentAPY}% | T-bill: ${yieldData.tbillRate}%`);

    // Step 2 — Resolve any predictions that are now 24h old
    resolveOldPredictions(yieldData);

    // Step 3a — Always generate and log a new prediction (builds track record)
    const prediction = await generatePrediction(yieldData);
    appendPrediction(prediction, yieldData);
    console.log("Prediction logged:", JSON.stringify(prediction, null, 2));

    // Step 3b — Check if yield moved enough to alert the user
    const user = loadUser();
    const usdyChange = Math.abs(yieldData.usdyCurrentAPY - yieldData.usdyPreviousAPY);
    const methChange = Math.abs(yieldData.methCurrentAPR - yieldData.methPreviousAPR);
    const significantChange = usdyChange > ALERT_THRESHOLD || methChange > ALERT_THRESHOLD;

    const currentSpread  = yieldData.usdyCurrentAPY - yieldData.methCurrentAPR;
    const previousSpread = yieldData.usdyPreviousAPY - yieldData.methPreviousAPR;
    const spreadCrossedAlert  = currentSpread >= SPREAD_ALERT_THRESHOLD && previousSpread < SPREAD_ALERT_THRESHOLD;
    const spreadAboveProposal = currentSpread >= SPREAD_PROPOSAL_THRESHOLD;
    const spreadAboveAlert    = currentSpread >= SPREAD_ALERT_THRESHOLD;

    console.log(`Delegation tier: ${user.userTier}`);
    console.log(`Spread (USDY - mETH): ${currentSpread.toFixed(2)}% | Alert: ${SPREAD_ALERT_THRESHOLD}% | Proposal: ${SPREAD_PROPOSAL_THRESHOLD}%`);

    const shouldAlert = significantChange || spreadCrossedAlert || spreadAboveProposal;

    if (shouldAlert) {
      // Determine alert type
      let alertType = "yield_change";
      if (spreadAboveProposal) alertType = "rebalance_proposal";
      else if (spreadAboveAlert) alertType = "spread_alert";

      console.log(`Alert triggered — type: ${alertType} | spread: ${currentSpread.toFixed(2)}%`);

      // Add spread context to yieldData so generateExplanation can use it
      yieldData.currentSpread        = currentSpread;
      yieldData.alertType            = alertType;
      yieldData.spreadAboveProposal  = spreadAboveProposal;

      // Step 4 — Generate plain-English explanation
      const explanation = await generateExplanation(yieldData, user);
      console.log("\n=== ALERT ===");
      console.log(`Type: ${alertType}`);
      console.log(explanation);
      console.log("=============\n");

      // Tier 1 (Watch Only): log but don't write a pending action alert
      if (user.tierCode === 1) {
        console.log("Tier 1 active — alert logged, no action proposed.");
      } else if (!hasPendingUnsentAlert()) {
        // Tier 2: write pendingAlert.json for bot to pick up and send
        writePendingAlert(explanation, prediction, yieldData, alertType);
      } else {
        console.log("Previous alert still unsent — skipping overwrite.");
      }
    } else {
      console.log(`Watching... USDY Δ${usdyChange.toFixed(3)}% | mETH Δ${methChange.toFixed(3)}% | Spread ${currentSpread.toFixed(2)}%`);
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
