// Regression test: server-side USDY and mETH/cmETH prices must come from
// live CoinGecko (USDY id = 'ondo-us-dollar-yield', mETH id =
// 'mantle-staked-ether'), not hardcoded constants. USDY accrues over time
// (1.013 was stale; ~1.14 today) and mETH trades at a premium to ETH (it's
// an accruing LST), so the raw 'ethereum' price systematically undervalues
// the portfolio.
//
// Static text checks — no network/RPC. Each target must either reference
// the CoinGecko ids directly OR import a shared helper that does.
//
// Run: node data/tests/server-prices-live.test.mjs

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';

const TARGETS = ['src/bot.js', 'src/agent.js', 'api/execute.js'];
const SHARED  = 'src/prices.js';

console.log('REGRESSION: server-side pricing is live (no 1.013 literal, real CoinGecko ids reachable)');
console.log();

const failures = [];
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { console.log('  ✗ ' + name + ' — ' + e.message); failures.push(name); }
}

// 1) No hardcoded 1.013 anywhere in the three targets
for (const f of TARGETS) {
  check('no hardcoded 1.013 in ' + f, () => {
    const src = readFileSync(f, 'utf8');
    assert.ok(!/\b1\.013\b/.test(src), 'still contains literal 1.013');
  });
}

// 2) Each target must reach the CoinGecko USDY + mETH ids (directly or via shared helper)
function reaches(file, needle) {
  const src = readFileSync(file, 'utf8');
  if (src.includes(needle)) return true;
  if (existsSync(SHARED)) {
    const importRe = /from\s+['"][^'"]*prices(\.js)?['"]/;
    if (importRe.test(src)) {
      const helperSrc = readFileSync(SHARED, 'utf8');
      if (helperSrc.includes(needle)) return true;
    }
  }
  return false;
}

for (const f of TARGETS) {
  check(f + ' reaches ondo-us-dollar-yield (USDY accruing price)', () => {
    assert.ok(reaches(f, 'ondo-us-dollar-yield'),
      'no USDY-specific CoinGecko id reachable from this file (directly or via ./prices.js / ../src/prices.js)');
  });
  check(f + ' reaches mantle-staked-ether (mETH-specific price)', () => {
    assert.ok(reaches(f, 'mantle-staked-ether'),
      'no mETH-specific CoinGecko id reachable from this file');
  });
}

console.log();
if (failures.length === 0) {
  console.log('✅ PASS — server-side pricing is live across all three sites');
  process.exit(0);
} else {
  console.log('❌ FAIL (' + failures.length + ' check' + (failures.length === 1 ? '' : 's') + ')');
  process.exit(1);
}
