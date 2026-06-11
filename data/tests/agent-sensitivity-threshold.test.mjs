// Regression test: the agent must fire a rebalance_proposal when:
//   - spread is at/above the sensitivity-mapped proposal threshold
//   - the SOURCE-asset balance × 0.5 is >= the $10 viability floor
//
// Bug it catches (observed on Jun 10): allocation-weighting used
// Math.min(usdyUSD, methUSD) * 0.5 — for a mETH-overweight wallet
// (USDY=$13, mETH=$70) where USDY leads on yield (direction = meth_to_usdy),
// the calc returned $6.50 (half the SMALLER side) and downgraded the proposal
// to spread_alert, even though half the SOURCE side ($35) is plenty.
//
// Extracts decideRebalance + getUserThresholds from agent.js via regex + new
// Function so we don't trigger agent.js's top-level cron/runAgentLoop on import.
//
// Run: node data/tests/agent-sensitivity-threshold.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'fs';

const src = readFileSync('src/agent.js', 'utf8');

function extract(name) {
  const re = new RegExp('function\\s+' + name + '[\\s\\S]*?\\n\\}');
  const m = src.match(re);
  return m ? m[0] : null;
}

const thSrc  = extract('getUserThresholds');
const decSrc = extract('decideRebalance');

if (!thSrc) {
  console.log('❌ FAIL — getUserThresholds not found in src/agent.js');
  process.exit(1);
}
if (!decSrc) {
  console.log('❌ FAIL — decideRebalance not found in src/agent.js (needs extraction)');
  process.exit(1);
}

let decideRebalance;
try {
  const factory = new Function(thSrc + '\n' + decSrc + '\nreturn { decideRebalance };');
  ({ decideRebalance } = factory());
} catch (e) {
  console.log('❌ FAIL — could not eval extracted helpers:', e.message);
  process.exit(1);
}
if (typeof decideRebalance !== 'function') {
  console.log('❌ FAIL — decideRebalance is not a function after eval');
  process.exit(1);
}

console.log('REGRESSION: sensitivity threshold + allocation-weighting in decideRebalance');
console.log();

function decide(overrides) {
  return decideRebalance({
    usdyUSD: 13,
    methUSD: 70,
    currentSpread: 1.57,
    usdyCurrentAPY: 3.55,
    methCurrentAPR: 1.98,
    sensitivity: 'high',
    tierCode: 2,
    ...overrides,
  });
}

const cases = [
  ['high + 1.57% spread + mETH-overweight wallet → rebalance_proposal fires', () => {
    const d = decide({ sensitivity: 'high', currentSpread: 1.57 });
    assert.equal(d.alertType, 'rebalance_proposal',
      'expected rebalance_proposal, got ' + d.alertType + ' (reason: ' + (d.reason || 'n/a') + '; positionToShift=$' + (d.positionToShift || 0).toFixed(2) + ')');
    assert.equal(d.direction, 'meth_to_usdy', 'wrong direction');
    assert.ok(d.positionToShift >= 10,
      'positionToShift should be ≥ $10 (mETH source $70 × 0.5 = $35); got $' + d.positionToShift);
  }],
  ['balanced + 1.2% spread → no proposal (below balanced 1.5% alert)', () => {
    const d = decide({ sensitivity: 'balanced', currentSpread: 1.2 });
    assert.notEqual(d.alertType, 'rebalance_proposal');
  }],
  ['major + 1.57% spread → no proposal (below major 2.0% alert)', () => {
    const d = decide({ sensitivity: 'major', currentSpread: 1.57 });
    assert.notEqual(d.alertType, 'rebalance_proposal');
  }],
  ['high + 1.57% + Watch Only (tier 1) → no proposal (downgrades regardless of spread)', () => {
    const d = decide({ sensitivity: 'high', currentSpread: 1.57, tierCode: 1 });
    assert.notEqual(d.alertType, 'rebalance_proposal');
  }],
  ['high + 1.57% + tiny source ($5 mETH) → no proposal (position viability floor)', () => {
    const d = decide({ sensitivity: 'high', currentSpread: 1.57, methUSD: 5, usdyUSD: 50 });
    assert.notEqual(d.alertType, 'rebalance_proposal');
  }],
];

const failures = [];
for (const [label, fn] of cases) {
  try { fn(); console.log('  ✓ ' + label); }
  catch (e) { console.log('  ✗ ' + label + ' — ' + e.message); failures.push(label); }
}

console.log();
if (failures.length === 0) {
  console.log('✅ PASS — decideRebalance fires proposals correctly across sensitivity tiers + allocations');
  process.exit(0);
} else {
  console.log('❌ FAIL (' + failures.length + ' case' + (failures.length === 1 ? '' : 's') + '): ' + failures.join(' | '));
  process.exit(1);
}
