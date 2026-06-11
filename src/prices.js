// Server-side live pricing for USDY, mETH, cmETH.
// One CoinGecko fetch per refresh (never per token). Fully wrapped in
// try/catch — a CoinGecko outage falls back to safe priors so the caller's
// refresh never breaks.
//
// USDY: 'ondo-us-dollar-yield' — USDY accrues (drifts ~$1 → ~$1.14+ over time).
//   The old hardcoded 1.013 went stale within weeks and undervalued portfolios.
// mETH: 'mantle-staked-ether' — mETH/cmETH are accruing LSTs that trade at a
//   premium to raw ETH. Falls back to 'ethereum' if mantle-staked-ether is
//   missing from the response (CoinGecko occasionally drops it from the join).
// cmETH: same redemption value as mETH for pricing purposes (same underlying).
//
// Fallbacks if the entire fetch fails: USDY 1.13, ETH 2500 — both deliberately
// chosen to be conservative-but-recent (Jun 2026 baseline) so a fallback render
// is still in the right ballpark rather than the old 1.013/2500 staleness.

const USDY_FALLBACK = 1.13;
const ETH_FALLBACK  = 2500;
const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=ondo-us-dollar-yield,mantle-staked-ether,ethereum&vs_currencies=usd';

export async function fetchTokenPrices() {
  let usdy = USDY_FALLBACK;
  let meth = ETH_FALLBACK;
  try {
    const r = await fetch(COINGECKO_URL);
    if (r.ok) {
      const d = await r.json();
      const u = d && d['ondo-us-dollar-yield'] && d['ondo-us-dollar-yield'].usd;
      const m = d && d['mantle-staked-ether'] && d['mantle-staked-ether'].usd;
      const e = d && d['ethereum'] && d['ethereum'].usd;
      if (typeof u === 'number' && u > 0) usdy = u;
      if (typeof m === 'number' && m > 0) meth = m;
      else if (typeof e === 'number' && e > 0) meth = e;
    }
  } catch {
    // intentional: fall through with priors so refresh never breaks
  }
  return { usdy, meth, cmeth: meth };
}
