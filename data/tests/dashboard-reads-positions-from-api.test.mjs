// Regression test: the dashboard must read position balances from /api/profile,
// not hardcoded JS constants or localStorage fallbacks. Catches the class of
// bug where Redis profile is fresh but the dashboard renders stale numbers
// because the read path was never wired.
//
// Static text checks on dashboard.html — no DOM, no browser required. Fast.
//
// Run: node data/tests/dashboard-reads-positions-from-api.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'fs';

const html = readFileSync('dashboard.html', 'utf8');

console.log('REGRESSION: dashboard reads positions from /api/profile (no hardcoded balances, no localStorage fallback)');
console.log();

const failures = [];
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { console.log('  ✗ ' + name + ' — ' + e.message); failures.push(name); }
}

// ── Sanity check the backend is correct (the dashboard's intended source of truth)
console.log('Backend sanity check:');
const profile = await fetch('https://rwai.fyi/api/profile').then(r => r.json());
check('/api/profile returns positions.USDY.balance > 0 (chain truth)', () => {
  assert.ok(profile?.positions?.USDY?.balance > 0, 'profile.positions.USDY.balance missing or 0');
});
check('/api/profile returns positions.mETH.balance > 0', () => {
  assert.ok(profile?.positions?.mETH?.balance > 0, 'profile.positions.mETH.balance missing or 0');
});

console.log();
console.log('Dashboard source-text checks:');

// ── Bug-class 1: hardcoded balance constants must be gone
check("'var METH_BALANCE  = 0.0303' is NOT present (hardcoded pre-swap constant)", () => {
  assert.ok(!/var\s+METH_BALANCE\s*=\s*0\.0303/.test(html), 'still hardcoded METH_BALANCE = 0.0303');
});
check("no 'var USDY_BALANCE  = 0' / 'var CMETH_BALANCE  = 0' hardcoded inits", () => {
  // tolerate `var USDY_BALANCE` declaration without literal-zero init
  const matches = html.match(/var\s+(USDY|METH|CMETH)_BALANCE\s*=\s*0(?:\.\d+)?\s*[;,]/g) || [];
  assert.equal(matches.length, 0, 'found hardcoded zero/literal balance init(s): ' + JSON.stringify(matches));
});

// ── Bug-class 2: localStorage fallback for the USDY USD value must be gone
check("localStorage.getItem('rwai_usdy_usd') is NOT present (read path of stale cache)", () => {
  assert.ok(!html.includes("localStorage.getItem('rwai_usdy_usd')"), 'still reading from localStorage rwai_usdy_usd');
});
check('USDY_FALLBACK_USD is NOT present (magic default $33.80)', () => {
  assert.ok(!html.includes('USDY_FALLBACK_USD'), 'USDY_FALLBACK_USD still referenced');
});
check('literal 33.80 fallback default is NOT present', () => {
  assert.ok(!/\|\|\s*33\.80\b/.test(html), 'still falling back to literal 33.80');
});

// ── Bug-class 3: dashboard must actually read positions from the API
// Intent: dashboard reads the .positions object from /api/profile AND reads
// per-asset .balance fields. Variable names are deliberately not asserted.
check('dashboard reads .positions and per-asset .balance from API response', () => {
  assert.ok(/\.positions\b/.test(html), 'no `.positions` access anywhere in dashboard');
  assert.ok(/\.(USDY|mETH|cmETH)\.balance\b/.test(html), 'no per-asset `.balance` read (USDY/mETH/cmETH)');
  assert.ok(/fetch\(['"]\/api\/profile/.test(html), 'no fetch to /api/profile (or wrong quoting)');
});

// ── Bug-class 4: stale-localStorage cleanup must fire (so existing users self-heal)
check("loadPositionsFromAPI removes stale localStorage 'rwai_usdy_usd'", () => {
  assert.ok(/localStorage\.removeItem\(['"]rwai_usdy_usd['"]\)/.test(html), 'no cleanup of stale localStorage key');
});

console.log();
if (failures.length === 0) {
  console.log('✅ PASS — dashboard is API-driven, no hardcoded position constants or localStorage fallback');
  process.exit(0);
} else {
  console.log(`❌ FAIL (${failures.length} check${failures.length === 1 ? '' : 's'}): ` + failures.join(' | '));
  process.exit(1);
}
