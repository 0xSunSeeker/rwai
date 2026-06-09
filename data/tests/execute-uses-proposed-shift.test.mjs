// Regression test: executeRebalance() must size the swap from the agent's
// alert.yieldData.proposedShiftUSD with a 5% safety cap against the
// on-chain source-asset balance, NOT from a hardcoded 50%-of-DOM-value
// calculation. Ensures the on-chain trade matches what the agent proposed
// and what the Simulate modal previewed.
//
// Static text checks on dashboard.html — no DOM/browser needed.
//
// Run: node data/tests/execute-uses-proposed-shift.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'fs';

const html = readFileSync('dashboard.html', 'utf8');

console.log('REGRESSION: executeRebalance sizes from alert.yieldData.proposedShiftUSD (with safety cap)');
console.log();

const failures = [];
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { console.log('  ✗ ' + name + ' — ' + e.message); failures.push(name); }
}

// ── Backend sanity: the agent IS publishing the fields the dashboard needs to read.
console.log('Backend sanity check:');
const alert = await fetch('https://rwai.fyi/api/pending-alert').then(r => r.json());
check('alert.yieldData.proposedShiftUSD is a positive number', () => {
  const v = alert?.yieldData?.proposedShiftUSD;
  assert.ok(typeof v === 'number' && v > 0, 'proposedShiftUSD missing or non-positive: ' + v);
});
check('alert.yieldData.proposedDirection is meth_to_usdy | usdy_to_meth', () => {
  const d = alert?.yieldData?.proposedDirection;
  assert.ok(d === 'meth_to_usdy' || d === 'usdy_to_meth', 'proposedDirection invalid: ' + d);
});

console.log();
console.log('Dashboard source-text checks:');

// ── Must consume the agent's proposed size + direction
check('dashboard references `proposedShiftUSD` (consumes agent proposal)', () => {
  assert.ok(/proposedShiftUSD\b/.test(html), 'no proposedShiftUSD reference in dashboard.html');
});
check('dashboard references `proposedDirection` (direction from agent, not re-derived)', () => {
  assert.ok(/proposedDirection\b/.test(html), 'no proposedDirection reference in dashboard.html');
});

// ── The exact bug line must be gone. A guarded fallback that still uses Math.min(* 0.5, 50)
//    is allowed (different syntactic form: `shiftUSD = ...` without `var`), but the original
//    primary-path declaration line must not survive.
check('the literal `var shiftUSD = Math.min(sourceUSD * 0.5, 50)` primary-path line is gone', () => {
  assert.ok(!/var\s+shiftUSD\s*=\s*Math\.min\(sourceUSD\s*\*\s*0\.5\s*,\s*50\)/.test(html),
    'old hardcoded 50%/$50 primary-path sizing still present as the var-declaration');
});

// ── Safety cap: 5% headroom multiplier
check('safety-cap multiplier `* 0.95` is present (5% headroom for slippage/gas)', () => {
  assert.ok(/\*\s*0\.95\b/.test(html), 'no * 0.95 headroom multiplier — safety cap missing');
});

// ── Diagnostic log line per spec point (f)
check("diagnostic console log '[execute] agent proposed' is present", () => {
  assert.ok(html.includes('[execute] agent proposed'), 'no [execute] agent proposed diagnostic log');
});

// ── Fallback path must warn (never silent — per spec point e)
check("fallback path uses console.warn (regression-detectable, not silent)", () => {
  assert.ok(/console\.warn\([^)]*proposedShiftUSD[^)]*\)/.test(html) || /console\.warn\([^)]*legacy 50%/.test(html),
    'no console.warn for the proposedShiftUSD-missing fallback');
});

console.log();
if (failures.length === 0) {
  console.log('✅ PASS — executeRebalance uses agent-sized proposal with safety cap');
  process.exit(0);
} else {
  console.log(`❌ FAIL (${failures.length} check${failures.length === 1 ? '' : 's'}): ` + failures.join(' | '));
  process.exit(1);
}
