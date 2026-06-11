// src/agent.js
// The autonomous loop — runs every 30 minutes, fetches yield data, detects
// changes, generates explanations and predictions, and logs everything.

import cron from "node-cron";
import dotenv from "dotenv";
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "fs";
import { ethers } from "ethers";
import { fetchAllYieldData } from "./dataFetcher.js";
import { generateExplanation, generatePrediction } from "./promptEngine.js";
import { logDecision } from "./reputation.js";
import { fetchTokenPrices } from "./prices.js";
dotenv.config();

const VAULT_ADDRESS = process.env.VAULT_ADDRESS;
const MANTLE_RPC    = process.env.MANTLE_RPC || 'https://rpc.mantle.xyz';
const PRIVATE_KEY   = process.env.MANTLE_PRIVATE_KEY;

const VAULT_ABI = [
  'function executeSwap(address user, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, bytes32 reasonHash, address[] calldata swapPath) external returns (uint256)',
  'function userCaps(address user) view returns (uint256)',
  'function DEFAULT_CAP() view returns (uint256)',
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

const USDY_ADDRESS  = '0x5bE26527e817998A7206475496fDE1E68957c5A6';
const mETH_ADDRESS  = '0xcDA86A272531e8640cD7F1a92c01839911B90bb0';
const cmETH_ADDRESS = '0xE6829d9a7eE3040e1276Fa75293Bde931859e8fA';
const WMNT_ADDRESS  = '0x78c1b0C915c4FAA5FffA6CAbf0219DA63d7f4cb8';

const SWAP_PATH_USDY_TO_METH = [USDY_ADDRESS, WMNT_ADDRESS, mETH_ADDRESS];
const SWAP_PATH_METH_TO_USDY = [mETH_ADDRESS, WMNT_ADDRESS, USDY_ADDRESS];

// Defensive net: refresh on-chain balances at the top of every agent loop so
// drift from any source (executed swaps, deposits, withdrawals) self-heals
// within 30 min. Complements the execute-time refresh in /api/execute.
async function refreshAgentPositions(profile) {
  const wallet = profile && profile.walletAddress;
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return;
  try {
    const provider = new ethers.JsonRpcProvider(MANTLE_RPC);
    const erc20    = ['function balanceOf(address) view returns (uint256)'];
    const [usdyRaw, methRaw, cmethRaw] = await Promise.all([
      new ethers.Contract(USDY_ADDRESS,  erc20, provider).balanceOf(wallet),
      new ethers.Contract(mETH_ADDRESS,  erc20, provider).balanceOf(wallet),
      new ethers.Contract(cmETH_ADDRESS, erc20, provider).balanceOf(wallet),
    ]);
    const { usdy: usdyPrice, meth: methPrice, cmeth: cmethPrice } = await fetchTokenPrices();
    const usdyBal  = parseFloat(ethers.formatUnits(usdyRaw,  18));
    const methBal  = parseFloat(ethers.formatUnits(methRaw,  18));
    const cmethBal = parseFloat(ethers.formatUnits(cmethRaw, 18));
    const positions = {
      USDY:  { balance: usdyBal,  usdValue: usdyBal  * usdyPrice, apy: 3.55 },
      mETH:  { balance: methBal,  usdValue: methBal  * methPrice, apy: 2.06 },
      cmETH: { balance: cmethBal, usdValue: cmethBal * cmethPrice, apy: 2.31 },
    };
    const total = positions.USDY.usdValue + positions.mETH.usdValue + positions.cmETH.usdValue;
    // Update the in-memory profile so this loop's proposal logic sees fresh positions
    profile.positions = positions;
    profile.userPositionUSD = total;
    try {
      await fetch('https://rwai.fyi/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positions, userPositionUSD: total, lastSyncSource: 'agent-loop' }),
      });
      console.log(`Positions refreshed from chain: USDY=${usdyBal.toFixed(4)} mETH=${methBal.toFixed(6)} cmETH=${cmethBal.toFixed(6)}`);
    } catch (err) {
      console.warn('Position persist to Redis failed (continuing):', err.message);
    }
  } catch (err) {
    console.warn('Position refresh from chain failed (using stored values):', err.message);
  }
}

// LI.FI swap-economics probe — used to decide if a rebalance is worth proposing.
// fromAddress is a stable on-chain identity for the agent so quotes don't depend
// on whether the user has a wallet connected yet.
const RWAI_AGENT_ADDR = '0xDD3146732D4801b87e1244c51BDE734c8df2BF9f';

async function checkSwapEconomics(positionUSD, spreadPct, direction) {
  try {
    const fromToken = direction === 'meth_to_usdy' ? mETH_ADDRESS : USDY_ADDRESS;
    const toToken   = direction === 'meth_to_usdy' ? USDY_ADDRESS : mETH_ADDRESS;
    // Rough token-to-USD priors. LI.FI returns authoritative USD values; this is
    // just to size the wei-amount we ask it to quote.
    const tokenPriceUSD = direction === 'meth_to_usdy' ? 2300 : 1.01;
    const tokenAmount = positionUSD / tokenPriceUSD;
    const tokenAmountWei = BigInt(Math.floor(tokenAmount * 1e18)).toString();

    const params = new URLSearchParams({
      fromChain: '5000',
      toChain: '5000',
      fromToken,
      toToken,
      fromAmount: tokenAmountWei,
      fromAddress: RWAI_AGENT_ADDR,
      slippage: '0.005',
    });

    const res = await fetch(`https://li.quest/v1/quote?${params}`);
    if (!res.ok) return { available: false, reason: 'LI.FI quote unavailable' };

    const quote = await res.json();
    const fromUSD = parseFloat(quote.estimate?.fromAmountUSD || '0');
    const toUSD   = parseFloat(quote.estimate?.toAmountUSD   || '0');
    if (fromUSD <= 0) return { available: false, reason: 'LI.FI returned no usable quote' };

    const swapCost = fromUSD - toUSD;
    const swapCostPct = (swapCost / fromUSD) * 100;
    const annualGain = (spreadPct / 100) * fromUSD;
    const breakevenDays = annualGain > 0 ? (swapCost / annualGain) * 365 : 999;

    // No viability verdict here — the caller decides what to do with these
    // numbers based on the user's delegation tier.
    return {
      available: true,
      swapCost: swapCost.toFixed(2),
      swapCostPct: swapCostPct.toFixed(2),
      annualGain: annualGain.toFixed(2),
      breakevenDays: Math.round(breakevenDays),
      tool: quote.toolDetails?.name || quote.tool,
    };
  } catch (err) {
    return { available: false, reason: `Economics check failed: ${err.message}` };
  }
}

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

const SPREAD_ALERT_THRESHOLD    = 1.5;   // Fallback defaults
const SPREAD_PROPOSAL_THRESHOLD = 1.65;
const SPREAD_AUTOEXECUTE_THRESHOLD = 2.0;

function getUserThresholds(profile) {
  const sensitivity = profile.alertSensitivity || 'balanced';
  const presets = {
    high:     { alert: 0.5, proposal: 0.8,  autoExec: 1.2 },
    balanced: { alert: 1.5, proposal: 1.65, autoExec: 2.0 },
    major:    { alert: 2.0, proposal: 2.5,  autoExec: 3.0 },
  };
  return presets[sensitivity] || presets.balanced;
}

// Pure: given user + yield context, returns the spread-based alertType the agent
// would emit, plus the trade parameters (direction, positionToShift). Caller
// still wraps with significantChange / economics / Tier-3 gating.
//
// Sizing uses the SOURCE asset balance (the side being sold), not Math.min(both).
// Math.min broke imbalanced wallets — e.g. mETH-overweight (USDY=$13, mETH=$70)
// with USDY leading on yield would compute Math.min*0.5 = $6.50 and downgrade,
// even though half the actual source (mETH) is $35, well above the $10 floor.
function decideRebalance({ usdyUSD, methUSD, currentSpread, usdyCurrentAPY, methCurrentAPR, sensitivity, tierCode }) {
  const thresholds = getUserThresholds({ alertSensitivity: sensitivity });
  const usdyLeads  = usdyCurrentAPY > methCurrentAPR;
  const direction  = usdyLeads ? 'meth_to_usdy' : 'usdy_to_meth';
  const sourceUSD  = (direction === 'meth_to_usdy') ? methUSD : usdyUSD;
  const positionToShift = sourceUSD * 0.5;

  if (currentSpread < thresholds.alert) {
    return { alertType: null, positionToShift, direction, sourceUSD, thresholds };
  }
  if (currentSpread < thresholds.proposal) {
    return { alertType: 'spread_alert', positionToShift, direction, sourceUSD, thresholds, reason: 'below_proposal_threshold' };
  }
  if (tierCode === 1) {
    return { alertType: 'spread_alert', positionToShift, direction, sourceUSD, thresholds, reason: 'watch_only_tier' };
  }
  if (positionToShift < 10) {
    return { alertType: 'spread_alert', positionToShift, direction, sourceUSD, thresholds, reason: 'position_too_small' };
  }
  return { alertType: 'rebalance_proposal', positionToShift, direction, sourceUSD, thresholds };
}

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
async function hasPendingUnsentAlert() {
  // Primary: check Redis (source of truth — web/bot approvals write here)
  try {
    const res = await fetch('https://rwai.fyi/api/pending-alert');
    if (res.ok) {
      const data = await res.json();
      // pending:true means unresponded; null means no alert at all
      if (data === null) return false;
      if (data.pending !== true) return false;
      // Hardening: a proposal left unresponded for >48h is stale. Don't let it
      // block fresh proposals indefinitely (see stuck-alert incident May 14–22,
      // where one unresolved alert froze the agent's hero output for 8 days).
      const generatedAt = data.generatedAt ? new Date(data.generatedAt).getTime() : 0;
      const ageHours = generatedAt ? (Date.now() - generatedAt) / 3.6e6 : Infinity;
      if (ageHours > 48) {
        console.log(`Pending alert is ${Math.round(ageHours)}h old (>48h) — treating as expired, allowing overwrite.`);
        return false;
      }
      return true;
    }
  } catch {}
  // Fallback: local file (in case API is unreachable)
  if (!existsSync(PENDING_ALERT_PATH)) return false;
  try {
    const alert = JSON.parse(readFileSync(PENDING_ALERT_PATH, "utf8"));
    return alert.sent === false && !alert.approved && !alert.dismissed;
  } catch {
    return false;
  }
}

async function writePendingAlert(explanation, prediction, yieldData, alertType) {
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
  try {
    const res = await fetch('https://rwai.fyi/api/pending-alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(alert),
    });
    if (res.ok) console.log("Pending alert synced to Redis.");
    else console.warn("Redis alert sync failed:", res.status);
  } catch (err) {
    console.warn("Could not sync alert to Redis:", err.message);
  }
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
  return entry;
}

function patchLastPredictionTxHash(txHash) {
  try {
    const raw   = readFileSync(PREDICTIONS_PATH, 'utf8');
    const lines = raw.trimEnd().split('\n');
    const last  = JSON.parse(lines[lines.length - 1]);
    last.txHash = txHash;
    lines[lines.length - 1] = JSON.stringify(last);
    writeFileSync(PREDICTIONS_PATH, lines.join('\n') + '\n');
  } catch (err) {
    console.error('Failed to patch txHash into prediction:', err.message);
  }
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

      // Determine actual direction for USDY and mETH.
      // cmETH is excluded: the APY formula changed mid-stream (compounding → +0.25% flat),
      // making historical comparisons invalid. Accuracy is tracked on USDY + mETH only.
      const actualUsdy = toDirection(p.yieldAtPrediction.usdyAPY, currentYield.usdyCurrentAPY);
      const actualMeth = toDirection(p.yieldAtPrediction.methAPR,  currentYield.methCurrentAPR);

      const usdyCorrect = p.usdyPrediction.direction === actualUsdy;
      const methCorrect = p.methPrediction.direction === actualMeth;

      resolved++;
      return JSON.stringify({
        ...p,
        resolved: true,
        resolvedAt: new Date().toISOString(),
        usdyPrediction: { ...p.usdyPrediction, correct: usdyCorrect, actualDirection: actualUsdy },
        methPrediction: { ...p.methPrediction, correct: methCorrect, actualDirection: actualMeth },
      });
    });

    if (resolved > 0) {
      writeFileSync(PREDICTIONS_PATH, updated.join("\n") + "\n");
      console.log(`Resolved ${resolved} prediction(s) against current yield.`);

      // Update agentAccuracy in userProfile so promptEngine uses the real number
      const allParsed = updated.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const done = allParsed.filter(p => p.resolved);
      // Count USDY + mETH only — cmETH excluded (formula change mid-stream)
      const total = done.reduce((n, p) => n + 2, 0);
      const correct = done.reduce((n, p) =>
        n + (p.usdyPrediction?.correct ? 1 : 0)
          + (p.methPrediction?.correct  ? 1 : 0), 0);
      if (total > 0 && existsSync(PROFILE_PATH)) {
        try {
          const profile = JSON.parse(readFileSync(PROFILE_PATH, "utf8"));
          profile.agentAccuracy = `${Math.round((correct / total) * 100)}% accurate over ${done.length} predictions`;
          writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2));
        } catch {}
      }
    }
    return resolved;
  } catch (err) {
    console.warn("resolveOldPredictions error:", err.message);
    return 0;
  }
}

// ─── REDIS PREDICTION SYNC ──────────────────────────────────────────────────────
// Dual-write: the local .jsonl append remains the permanent backup; these mirror
// the same data into Redis so the dashboard endpoints read it live (not from the
// stale deploy-time file).
async function syncPredictionToRedis(entry) {
  try {
    const res = await fetch('https://rwai.fyi/api/predictions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
    if (res.ok) console.log('Prediction synced to Redis.');
    else console.warn('Redis prediction sync failed:', res.status);
  } catch (err) {
    console.warn('Could not sync prediction to Redis:', err.message);
  }
}

// When resolveOldPredictions rewrites the file (marking 24h-old predictions
// correct/incorrect), re-sync the full list so Redis reflects those resolutions
// too. Self-healing: also repairs any drift between file and Redis.
async function rebuildRedisPredictions() {
  try {
    if (!existsSync(PREDICTIONS_PATH)) return;
    const entries = readFileSync(PREDICTIONS_PATH, 'utf8')
      .trim().split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
    const res = await fetch('https://rwai.fyi/api/predictions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    });
    if (res.ok) console.log(`Redis predictions re-synced after resolution (${entries.length} entries).`);
    else console.warn('Redis re-sync failed:', res.status);
  } catch (err) {
    console.warn('Could not re-sync predictions to Redis:', err.message);
  }
}

// ─── TIER 3 EXECUTION ─────────────────────────────────────────────────────────
async function executeTier3Swap(user, yieldData) {
  if (!VAULT_ADDRESS || !PRIVATE_KEY) {
    console.log('Tier 3: VAULT_ADDRESS or MANTLE_PRIVATE_KEY not set — skipping execution');
    return null;
  }

  try {
    const provider = new ethers.JsonRpcProvider(MANTLE_RPC);
    const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);
    const vault    = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, wallet);

    const usdyLeads = yieldData.usdyCurrentAPY > yieldData.methCurrentAPR;
    const tokenIn   = usdyLeads ? mETH_ADDRESS  : USDY_ADDRESS;
    const tokenOut  = usdyLeads ? USDY_ADDRESS  : mETH_ADDRESS;
    const swapPath  = usdyLeads ? SWAP_PATH_METH_TO_USDY : SWAP_PATH_USDY_TO_METH;

    const tokenInContract  = new ethers.Contract(tokenIn, ERC20_ABI, provider);
    const userWalletAddress = user.walletAddress || '0x9297Cb7E6Dab5E1A8a56F39B1C2D6e3E8A5f56d3';
    const userBalance       = await tokenInContract.balanceOf(userWalletAddress);

    if (userBalance === 0n) {
      console.log('Tier 3: zero balance for tokenIn — skipping');
      return null;
    }

    const userCap    = await vault.userCaps(wallet.address);
    const defaultCap = await vault.DEFAULT_CAP();
    const cap        = userCap > 0n ? userCap : defaultCap;

    const swapAmount = userBalance / 4n;
    const amountIn   = swapAmount > cap ? cap : swapAmount;

    if (amountIn === 0n) {
      console.log('Tier 3: calculated swap amount is zero — skipping');
      return null;
    }

    const allowance = await tokenInContract.allowance(wallet.address, VAULT_ADDRESS);
    if (allowance < amountIn) {
      console.log('Tier 3: insufficient allowance — user needs to approve vault first');
      return null;
    }

    const reasoning  = `RWAI Tier 3 auto-rebalance: spread ${(yieldData.currentSpread).toFixed(2)}% exceeds 2.0% threshold. Moving 25% of position to higher-yielding asset.`;
    const reasonHash = ethers.keccak256(ethers.toUtf8Bytes(reasoning));

    console.log(`Tier 3: executing swap — ${ethers.formatUnits(amountIn, 18)} tokenIn via [${swapPath.join(' → ')}]`);

    const tx = await vault.executeSwap(
      userWalletAddress,
      tokenIn,
      tokenOut,
      amountIn,
      0n,
      reasonHash,
      swapPath,
      { gasLimit: 500000n }
    );

    console.log(`Tier 3: tx submitted — ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`Tier 3: confirmed in block ${receipt.blockNumber}`);

    return {
      txHash:      tx.hash,
      amountIn:    ethers.formatUnits(amountIn, 18),
      tokenIn,
      tokenOut,
      reasoning,
      blockNumber: receipt.blockNumber,
    };

  } catch (err) {
    console.error('Tier 3 execution error:', err.message);
    return null;
  }
}

// ─── CORE LOOP FUNCTION ───────────────────────────────────────────────────────
async function runAgentLoop() {
  console.log(`\n[${new Date().toISOString()}] Agent loop running...`);

  let apiProfile = null;
  try {
    const res = await fetch('https://rwai.fyi/api/profile');
    if (res.ok) apiProfile = await res.json();
  } catch (err) {
    console.warn('Could not reach /api/profile, falling back to local file:', err.message);
  }

  const liveProfile = apiProfile || loadUser();

  if (liveProfile.agentPaused === true) {
    console.log('⏸ Agent is paused — skipping cycle. Resume from dashboard or Telegram to continue.');
    return;
  }

  // Refresh on-chain positions BEFORE proposal logic so this loop sees post-swap reality.
  // Safe to fail: stored positions are used as fallback.
  await refreshAgentPositions(liveProfile);

  try {
    // Step 1 — Fetch live yield data
    const yieldData = await fetchAllYieldData(previousSnapshot);
    console.log(`USDY: ${yieldData.usdyCurrentAPY}% | mETH: ${yieldData.methCurrentAPR}% | cmETH: ${yieldData.cmethCurrentAPY}% | T-bill: ${yieldData.tbillRate}%`);

    // Step 2 — Resolve any predictions that are now 24h old
    const resolvedCount = resolveOldPredictions(yieldData);
    if (resolvedCount > 0) await rebuildRedisPredictions();

    // Step 3a — Always generate and log a new prediction (builds track record)
    const prediction = await generatePrediction(yieldData);
    // Carry Claude's per-proposal confidence reasoning onto yieldData so the
    // dashboard tooltip can surface it. Defensive: null on missing/malformed.
    yieldData.confidenceReason = (prediction && typeof prediction.confidenceReason === 'string' && prediction.confidenceReason.trim())
      ? prediction.confidenceReason.trim()
      : null;
    const predictionEntry = appendPrediction(prediction, yieldData);
    console.log("Prediction logged:", JSON.stringify(prediction, null, 2));

    // Anchor prediction on-chain and write txHash back to the entry
    const anchor = await logDecision(
      (yieldData.usdyCurrentAPY - yieldData.methCurrentAPR).toFixed(2),
      JSON.stringify(prediction)
    );
    if (anchor?.txHash) {
      patchLastPredictionTxHash(anchor.txHash);
      predictionEntry.txHash = anchor.txHash;
      console.log(`🔗 Prediction anchored on Mantle: ${anchor.txHash}`);
    }

    // Dual-write the prediction into Redis so the dashboard reads it live
    await syncPredictionToRedis(predictionEntry);

    // Step 3b — Check if yield moved enough to alert the user
    const user = liveProfile;
    const usdyChange = Math.abs(yieldData.usdyCurrentAPY - yieldData.usdyPreviousAPY);
    const methChange = Math.abs(yieldData.methCurrentAPR - yieldData.methPreviousAPR);
    const significantChange = usdyChange > ALERT_THRESHOLD || methChange > ALERT_THRESHOLD;

    const currentSpread  = yieldData.usdyCurrentAPY - yieldData.methCurrentAPR;
    const decision = decideRebalance({
      usdyUSD: user.positions?.USDY?.usdValue || 0,
      methUSD: user.positions?.mETH?.usdValue || 0,
      currentSpread,
      usdyCurrentAPY: yieldData.usdyCurrentAPY,
      methCurrentAPR: yieldData.methCurrentAPR,
      sensitivity: user.alertSensitivity,
      tierCode: user.tierCode,
    });
    const thresholds = decision.thresholds;
    const spreadAboveAutoExecute = currentSpread >= thresholds.autoExec;

    console.log(`Delegation tier: ${user.userTier}`);
    console.log(`Spread (USDY - mETH): ${currentSpread.toFixed(2)}% | Sensitivity: ${user.alertSensitivity || 'balanced'} | Alert: ${thresholds.alert}% | Proposal: ${thresholds.proposal}% | Auto: ${thresholds.autoExec}%`);

    // yield_change still fires from significantChange when no spread-based alert
    let alertType = decision.alertType;
    if (!alertType && significantChange) alertType = 'yield_change';
    const shouldAlert = !!alertType;

    if (shouldAlert) {
      console.log(`Alert triggered — type: ${alertType} | spread: ${currentSpread.toFixed(2)}%`);
      if (decision.reason === 'position_too_small') {
        console.log(`Position too small to rebalance: $${decision.positionToShift.toFixed(2)} < $10 minimum (source: ${decision.direction === 'meth_to_usdy' ? 'mETH' : 'USDY'} $${decision.sourceUSD.toFixed(2)})`);
      } else if (decision.reason === 'watch_only_tier') {
        console.log(`Watch Only tier — proposal downgraded to spread_alert`);
      }

      // Add spread context to yieldData so generateExplanation can use it
      yieldData.currentSpread        = currentSpread;
      yieldData.alertType            = alertType;
      yieldData.spreadAboveProposal  = (alertType === 'rebalance_proposal');

      // Economics gate (rebalance proposals only): surface the numbers, then
      // strict Tier 3 breakeven cap. Tier 2 always proposes regardless of breakeven.
      if (alertType === 'rebalance_proposal') {
        const positionToShift = decision.positionToShift;
        const direction       = decision.direction;
        const economics = await checkSwapEconomics(positionToShift, currentSpread, direction);
        yieldData.swapEconomics     = economics;
        yieldData.proposedDirection = direction;
        yieldData.proposedShiftUSD  = positionToShift;

        const bk = economics.available ? `${economics.breakevenDays} days` : 'unknown (quote unavailable)';
        if (user.tierCode === 3) {
          if (economics.available && economics.breakevenDays < 90) {
            console.log(`[Tier 3] Breakeven ${bk} — within 90-day auto-execute window`);
          } else {
            console.log(`[Tier 3 gate] Refusing auto-execute path — breakeven ${bk} exceeds 90`);
            alertType = 'spread_alert';
            yieldData.alertType = alertType;
            yieldData.spreadAboveProposal = false;
          }
        } else {
          console.log(`[Tier 2] Proposing with breakeven ${bk} — user decides`);
        }
      }

      // Step 4 — Generate plain-English explanation
      const explanation = await generateExplanation(yieldData, user);
      console.log("\n=== ALERT ===");
      console.log(`Type: ${alertType}`);
      console.log(explanation);
      console.log("=============\n");

      if (user.tierCode === 1) {
        console.log("Tier 1 active — alert logged, no action proposed.");
      } else if (user.tierCode === 3 && spreadAboveAutoExecute) {
        console.log('Tier 3: spread above auto-execute threshold — attempting execution...');
        const result = await executeTier3Swap(user, yieldData);
        if (result) {
          await writePendingAlert(
            `✅ Auto-rebalance executed.\n\nMoved ${result.amountIn} tokens toward higher yield.\nTx: https://mantlescan.xyz/tx/${result.txHash}\n\nSpread was ${yieldData.currentSpread.toFixed(2)}% — above your 2.0% auto-execute threshold.`,
            prediction,
            yieldData,
            'auto_executed'
          );
        } else if (!await hasPendingUnsentAlert()) {
          await writePendingAlert(explanation, prediction, yieldData, alertType);
        }
      } else if (!await hasPendingUnsentAlert()) {
        await writePendingAlert(explanation, prediction, yieldData, alertType);
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
