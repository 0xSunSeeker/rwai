import dotenv from "dotenv";
dotenv.config();

export async function fetchUSDYData() {
  try {
    // rwa.xyz API is dead — use DefiLlama, preferring the Mantle chain pool
    const response = await fetch("https://yields.llama.fi/pools", {
      headers: { "Accept": "application/json" }
    });
    const data = await response.json();
    const pool =
      data.data.find(p => p.project === "ondo-yield-assets" && p.symbol === "USDY" && p.chain === "Mantle") ??
      data.data.find(p => p.project === "ondo-yield-assets" && p.symbol === "USDY");
    const currentAPY = parseFloat(pool?.apy ?? 3.55);
    const apy7d = parseFloat(pool?.apyBase7d ?? currentAPY);
    const apy30d = parseFloat(pool?.apyMean30d ?? currentAPY);
    return { currentAPY, apy7d, apy30d, source: "defillama", fetchedAt: new Date().toISOString() };
  } catch (err) {
    console.error("USDY fetch failed — using fallback:", err.message);
    return { currentAPY: 3.55, apy7d: 3.55, apy30d: 3.55, source: "fallback", fetchedAt: new Date().toISOString() };
  }
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

      // ── Layer 2: cross-validate with pricePerShare change ────────────────
      // mETH yield is baked into the ETH/mETH exchange rate.
      // APR = ((rate_today / rate_yesterday) ^ 365 − 1) × 100
      let aprFromRate = null;
      if (latest.pricePerShare && prev.pricePerShare && latest.pricePerShare !== prev.pricePerShare) {
        const daily = latest.pricePerShare / prev.pricePerShare;
        aprFromRate = parseFloat(((Math.pow(daily, 365) - 1) * 100).toFixed(4));
        console.log(`mETH pricePerShare: ${prev.pricePerShare} → ${latest.pricePerShare} | rate-derived APR: ${aprFromRate}%`);
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
  return {
    usdyCurrentAPY: usdy.currentAPY,
    usdyPreviousAPY: previousSnapshot?.usdyCurrentAPY ?? usdy.currentAPY,
    usdyApy7d: usdy.apy7d,
    usdyApy30d: usdy.apy30d,
    methCurrentAPR: meth.currentAPR,
    methPreviousAPR: previousSnapshot?.methCurrentAPR ?? meth.currentAPR,
    methApy7d: meth.apy7d,
    methApy30d: meth.apy30d,
    methAprFromRate: meth.aprFromRate ?? null,   // rate-derived cross-check
    methPricePerShare: meth.pricePerShare ?? null,
    methDataSource: meth.source,
    tbillRate: tbill.current,
    recentTbillTrend: tbill.trend,
    recentMethTrend,
    recentUsdyTrend,
    triggerAsset: Math.abs(usdy.currentAPY - (previousSnapshot?.usdyCurrentAPY ?? usdy.currentAPY)) > Math.abs(meth.currentAPR - (previousSnapshot?.methCurrentAPR ?? meth.currentAPR)) ? "USDY" : "mETH",
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