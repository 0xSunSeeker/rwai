// Regression test: when LI.FI's quote.estimate.fromAmountUSD diverges from the
// shiftUSD we asked for (because the browser's CoinGecko price global was
// stale or fallback), executeRebalance must use the quote's implied price as
// a feedback signal, resize once with the safety cap re-applied, and re-quote
// — BEFORE the confirm dialog is shown. One retry maximum. Single-quote-feedback
// fix; works regardless of WHY the price prior was wrong.
//
// Static text checks on dashboard.html — no DOM/browser/RPC required.
//
// Run: node data/tests/execute-quote-feedback-resize.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'fs';

const html = readFileSync('dashboard.html', 'utf8');

console.log('REGRESSION: executeRebalance does quote-feedback resize when fromAmountUSD diverges from shiftUSD');
console.log();

const failures = [];
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { console.log('  ✗ ' + name + ' — ' + e.message); failures.push(name); }
}

// 1. The divergence check itself
check('divergence check: Math.abs(fromUSD - shiftUSD) / shiftUSD against a 0.10 threshold', () => {
  const hasMath = /Math\.abs\s*\(\s*fromUSD\s*-\s*shiftUSD\s*\)\s*\/\s*shiftUSD/.test(html);
  assert.ok(hasMath, 'no Math.abs(fromUSD - shiftUSD) / shiftUSD comparison');
  assert.ok(/0\.10\b|0\.1\b/.test(html), 'no 0.10 / 0.1 divergence threshold');
});

// 2. Implied-price recompute from the quote
check('implied-price recompute exists (fromUSD / tokenAmount, or impliedPrice variable)', () => {
  const hasImplied = /\bimpliedPrice\b/.test(html);
  const hasMath = /fromUSD\s*\/\s*tokenAmount/.test(html);
  assert.ok(hasImplied || hasMath, 'no implied-price computation');
});

// 3. Diagnostic log string (per spec)
check("'[execute] price check' diagnostic log is present", () => {
  assert.ok(html.includes('[execute] price check'), 'no [execute] price check log');
});

// 4. Single-retry guard: exactly two /api/quote fetches in the file (original + retry)
check('exactly two /api/quote URL builds in dashboard (original + single retry, no loop)', () => {
  const matches = html.match(/\/api\/quote/g) || [];
  assert.equal(matches.length, 2, 'expected exactly 2 /api/quote URL strings, found ' + matches.length);
});

// 5. Safety cap re-applied with the implied price (>=2 occurrences of * 0.95)
check('safety cap re-applied after resize (>=2 occurrences of * 0.95)', () => {
  const m = html.match(/\*\s*0\.95\b/g) || [];
  assert.ok(m.length >= 2, 'expected >= 2 * 0.95 occurrences (original cap + post-resize cap), found ' + m.length);
});

// 6. Enhanced sizing log includes token count + price (so this class of bug is visible)
check("sizing log includes 'tokens @' (surfaces token count + price for in-browser inspection)", () => {
  assert.ok(/tokens?\s*@/i.test(html), "sizing log does not surface 'N tokens @ $P'");
});

console.log();
if (failures.length === 0) {
  console.log('✅ PASS — quote-feedback resize is wired');
  process.exit(0);
} else {
  console.log('❌ FAIL (' + failures.length + ' check' + (failures.length === 1 ? '' : 's') + '): ' + failures.join(' | '));
  process.exit(1);
}
