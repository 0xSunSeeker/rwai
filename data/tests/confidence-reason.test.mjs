// Regression test: the per-proposal confidence score must explain itself.
// (a) promptEngine asks Claude for a confidenceReason field
// (b) agent carries it onto yieldData / alert root with a safe default
// (c) dashboard tooltip render path references confidenceReason
// (d) tooltip falls back to static copy when the field is absent (old alerts)
//
// Static text checks — no network/RPC.
//
// Run: node data/tests/confidence-reason.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'fs';

const prompt = readFileSync('src/promptEngine.js', 'utf8');
const agent  = readFileSync('src/agent.js', 'utf8');
const html   = readFileSync('dashboard.html', 'utf8');

console.log('REGRESSION: confidence score explains itself (confidenceReason flows prompt → alert → tooltip)');
console.log();

const failures = [];
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { console.log('  ✗ ' + name + ' — ' + e.message); failures.push(name); }
}

// (a) Prompt asks for confidenceReason
check('promptEngine.js asks Claude for a confidenceReason field', () => {
  assert.ok(/confidenceReason/.test(prompt), 'no confidenceReason in src/promptEngine.js');
});

// (b) Agent carries confidenceReason onto yieldData or alert root
check('src/agent.js references confidenceReason (carries onto alert/yieldData)', () => {
  assert.ok(/confidenceReason/.test(agent), 'no confidenceReason in src/agent.js');
});

// (c) Dashboard tooltip render path references confidenceReason
check('dashboard.html references confidenceReason in tooltip render', () => {
  assert.ok(/confidenceReason/.test(html), 'no confidenceReason in dashboard.html');
});

// (d) Tooltip falls back to static copy when confidenceReason is absent
check('dashboard.html preserves static tooltip copy ("How certain the agent is")', () => {
  assert.ok(html.includes('How certain the agent is'),
    'static tooltip copy missing — old alerts (no confidenceReason) would render empty');
});

// (e) Tooltip-update flow runs from refreshHero / a render function (not just static HTML)
check('dashboard.html has a tooltip-update function reachable from the render cycle', () => {
  // Heuristic: an updater function with "ConfidenceTooltip" or equivalent string,
  // and a reference to the tooltip element id 'info-tip-confidence' from JS.
  const hasUpdater = /info-tip-confidence/.test(html) && /confidenceReason/.test(html);
  assert.ok(hasUpdater, 'tooltip update path not wired in dashboard');
});

console.log();
if (failures.length === 0) {
  console.log('✅ PASS — confidence reason flows prompt → alert → tooltip');
  process.exit(0);
} else {
  console.log('❌ FAIL (' + failures.length + ' check' + (failures.length === 1 ? '' : 's') + ')');
  process.exit(1);
}
