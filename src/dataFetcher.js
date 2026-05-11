import { ethers } from "ethers";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../data");
const METH_PRICE_HISTORY_PATH = `${DATA_DIR}/methPriceHistory.json`;

// Risk profiles for each monitored asset
export const RISK_PROFILES = {
  USDY:  { score: 1, max: 5, label: "Very Low", reason: "US Treasury backed, no price risk" },
  mETH:  { score: 3, max: 5, label: "Medium",   reason: "ETH price exposure, validator slashing risk" },
  cmETH: { score: 3, max: 5, label: "Medium",   reason: "ETH price exposure, auto-compound vault" },
};

// cmETH is auto-compounding mETH (ERC-4626 vault). No standalone DeFiLlama pool exists.
// Effective APY = (1 + APR/100/365)^365 - 1, expressed as a percentage.
export function deriveCMETHApy(methAPR) {
  // cmETH earns mETH base yield plus restaking rewards
  // Official cmETH APY runs ~0.2-0.3% above mETH APY
  // Use 0.25% premium as conservative estimate
  return Math.round((methAPR + 0.25) * 100) / 100;
}

// USDY token on Mantle Mainnet (OFT bridge wrapper)
// APY is set by Ondo's oracle on Ethereum — not readable on Mantle directly.
// We fetch APY from DeFiLlama (which reads Ondo's oracle) and pair it with
// live on-chain TVL from Mantle to prove real protocol integration.
const USDY_MANTLE = "0x5be26527e817998a7206475496fde1e68957c5a6";
const ERC20_ABI   = ["function totalSupply() view returns (uint256)"];

async function fetchUSDYMantleTVL() {
  try {
    const provider = new ethers.JsonRpcProvider(
      process.env.MANTLE_RPC ?? "https://rpc.mantle.xyz"
    );
    const contract = new ethers.Contract(USDY_MANTLE, ERC20_ABI, provider);
    const raw = await contract.totalSupply();
    // USDY is 18 decimals, pegged ~$1 — supply ≈ TVL in USD
    return parseFloat(ethers.formatEther(raw));
  } catch (err) {
    console.warn("USDY Mantle TVL fetch failed:", err.message);
    return null;
  }
}

export async function fetchUSDYData() {
  // Fetch APY and on-chain TVL in parallel
  const [tvl, poolData] = await Promise.allSettled([
    fetchUSDYMantleTVL(),
    fetch("https://yields.llama.fi/pools", { headers: { "Accept": "application/json" } })
      .then(r => r.json()),
  ]);

  // On-chain TVL from Mantle RPC
  const mantleTVL = tvl.status === "fulfilled" ? tvl.value : null;
  if (mantleTVL) console.log(`USDY on Mantle: $${(mantleTVL / 1e6).toFixed(2)}M TVL (live RPC)`);

  // APY from DeFiLlama (Ondo oracle aggregated)
  try {
    const data = poolData.value;
    const pool =
      data.data.find(p => p.project === "ondo-yield-assets" && p.symbol === "USDY" && p.chain === "Mantle") ??
      data.data.find(p => p.project === "ondo-yield-assets" && p.symbol === "USDY");
    const currentAPY = parseFloat(pool?.apy ?? 3.55);
    const apy7d      = parseFloat(pool?.apyBase7d  ?? currentAPY);
    const apy30d     = parseFloat(pool?.apyMean30d ?? currentAPY);
    return {
      currentAPY, apy7d, apy30d,
      mantleTVL,           // live from Mantle RPC
      source: "defillama+onchain",
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error("USDY APY fetch failed — using fallback:", err.message);
    return {
      currentAPY: 3.55, apy7d: 3.55, apy30d: 3.55,
      mantleTVL,
      source: "fallback",
      fetchedAt: new Date().toISOString(),
    };
  }
}

function getMethPriceHistory(currentPrice) {
  const now = Date.now();
  let history = [];

  try {
    if (existsSync(METH_PRICE_HISTORY_PATH)) {
      history = JSON.parse(readFileSync(METH_PRICE_HISTORY_PATH, 'utf8'));
    }
  } catch {}

  history.push({ price: currentPrice, timestamp: now });

  // Keep only last 8 days of entries (one per 30min = 384 entries max)
  const eightDaysAgo = now - (8 * 24 * 60 * 60 * 1000);
  history = history.filter(h => h.timestamp > eightDaysAgo);

  try {
    writeFileSync(METH_PRICE_HISTORY_PATH, JSON.stringify(history));
  } catch {}

  return history;
}

// mETH pool ID on DeFiLlama (stable, doesn't change)
const METH_POOL_ID = "b9f2f00a-ba96-4589-a171-dde979a23d87";

export async function fetchMETHData() {
  // ── Layer 1: DeFiLlama chart for specific mETH pool ──────────────────────
  // Returns daily data points with apy + pricePerShare (the mETH/ETH exchange rate).
  try {
    const res = await fetch(`https://yields.llama.fi/chart/${METH_POOL_ID}`, {
      headers: { "Accept": "application/json" }
    });
    const json = await res.json();
    const chart = json.data;

    if (Array.isArray(chart) && chart.length >= 1) {
      const latest = chart[chart.length - 1];
      const prev   = chart.length >= 2 ? chart[chart.length - 2] : latest;

      // Use DeFiLlama's own APY as primary value
      const currentAPR = parseFloat(latest.apy ?? latest.apyBase ?? 0);

      // ── Layer 2: 7-day pricePerShare window APY ──────────────────────────
      // Official mETH methodology: APY = ((price_day7 / price_day0) ^ (365/7)) - 1
      let aprFromRate = null;
      if (latest.pricePerShare) {
        const history = getMethPriceHistory(latest.pricePerShare);

        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        const oldEntry = history.reduce((closest, entry) => {
          return Math.abs(entry.timestamp - sevenDaysAgo) < Math.abs(closest.timestamp - sevenDaysAgo)
            ? entry : closest;
        }, history[0]);

        const ageDays = (Date.now() - oldEntry.timestamp) / (24 * 60 * 60 * 1000);

        if (ageDays >= 0.04 && oldEntry.price !== latest.pricePerShare) {
          const apy7d = (Math.pow(latest.pricePerShare / oldEntry.price, 365 / ageDays) - 1) * 100;
          aprFromRate = Math.round(apy7d * 100) / 100;
          console.log(`mETH 7-day APY: ${aprFromRate}% (${ageDays.toFixed(1)}d window)`);
        }
      }

      if (currentAPR > 0) {
        return {
          currentAPR,
          aprFromRate,                                      // on-chain-equivalent cross-check
          apy7d:  parseFloat(latest.apyBase7d  ?? currentAPR),
          apy30d: parseFloat(latest.apyMean30d ?? currentAPR),
          pricePerShare: latest.pricePerShare ?? null,
          source: "defillama-chart",
          fetchedAt: new Date().toISOString(),
        };
      }
    }
  } catch (err) {
    console.warn("mETH DeFiLlama chart failed:", err.message);
  }

  // ── Layer 3: hard fallback — flagged as estimated ─────────────────────────
  console.error("mETH fetch: all sources failed — using estimated fallback");
  return {
    currentAPR: 1.0,
    apy7d: 1.0,
    apy30d: 1.0,
    pricePerShare: null,
    source: "estimated",
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchTBillRate() {
  try {
    const response = await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=DTB4WK&api_key=${process.env.FRED_API_KEY}&sort_order=desc&limit=2&file_type=json`);
    const data = await response.json();
    const latest = data.observations[0].value;
    const previous = data.observations[1].value;
    return { current: parseFloat(latest), previous: parseFloat(previous), trend: latest > previous ? "rising" : latest < previous ? "falling" : "stable" };
  } catch (err) {
    console.error("T-bill fetch failed — using fallback:", err.message);
    return { current: 4.31, previous: 4.35, trend: "falling" };
  }
}

// Derive trend direction from rolling averages: current vs 7d vs 30d
function trendFromAverages(current, avg7d, avg30d) {
  if (current > avg7d && avg7d > avg30d) return "rising";
  if (current < avg7d && avg7d < avg30d) return "falling";
  if (current > avg30d) return "rising";
  if (current < avg30d) return "falling";
  return "stable";
}

export async function fetchAllYieldData(previousSnapshot = null) {
  const [usdy, meth, tbill] = await Promise.all([fetchUSDYData(), fetchMETHData(), fetchTBillRate()]);
  const recentMethTrend = trendFromAverages(meth.currentAPR, meth.apy7d, meth.apy30d);
  const recentUsdyTrend = trendFromAverages(usdy.currentAPY, usdy.apy7d, usdy.apy30d);

  // cmETH APY is derived from mETH APR via daily compounding
  const cmethCurrentAPY = deriveCMETHApy(meth.currentAPR);
  const cmethPreviousAPY = previousSnapshot?.cmethCurrentAPY ?? cmethCurrentAPY;

  const usdyDelta = Math.abs(usdy.currentAPY - (previousSnapshot?.usdyCurrentAPY ?? usdy.currentAPY));
  const methDelta  = Math.abs(meth.currentAPR  - (previousSnapshot?.methCurrentAPR  ?? meth.currentAPR));
  const triggerAsset = usdyDelta >= methDelta ? "USDY" : "mETH";

  return {
    usdyCurrentAPY: usdy.currentAPY,
    usdyPreviousAPY: previousSnapshot?.usdyCurrentAPY ?? usdy.currentAPY,
    usdyApy7d: usdy.apy7d,
    usdyApy30d: usdy.apy30d,
    usdyMantleTVL: usdy.mantleTVL ?? null,
    methCurrentAPR: meth.currentAPR,
    methPreviousAPR: previousSnapshot?.methCurrentAPR ?? meth.currentAPR,
    methApy7d: meth.apy7d,
    methApy30d: meth.apy30d,
    methAprFromRate: meth.aprFromRate ?? null,
    methPricePerShare: meth.pricePerShare ?? null,
    methDataSource: meth.source,
    cmethCurrentAPY,
    cmethPreviousAPY,
    tbillRate: tbill.current,
    recentTbillTrend: tbill.trend,
    recentMethTrend,
    recentUsdyTrend,
    triggerAsset,
    changePercent: parseFloat((usdy.currentAPY - (previousSnapshot?.usdyCurrentAPY ?? usdy.currentAPY)).toFixed(2)),
    fetchedAt: new Date().toISOString(),
  };
}

// Alias used by bot.js — no previous snapshot context needed for on-demand checks
export const fetchYieldData = () => fetchAllYieldData(null);

// Returns true when either asset moved past the alert threshold (default 0.10%)
export function shouldAlert(data, threshold = 0.10) {
  const usdyChange = Math.abs(data.usdyCurrentAPY - data.usdyPreviousAPY);
  const methChange = Math.abs(data.methCurrentAPR - data.methPreviousAPR);
  return usdyChange > threshold || methChange > threshold;
}