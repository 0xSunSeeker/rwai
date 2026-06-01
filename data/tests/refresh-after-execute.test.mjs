// Regression test: when /api/execute records a swap, the user's positions in
// the Redis profile must be refreshed from on-chain balances. Without this,
// the dashboard, agent proposals, and Simulate modal all read stale balances.
//
// Uses in-process handler invocation (no HTTP) so the TDD cycle doesn't
// require a Vercel deploy between RED and GREEN. Snapshots live Redis state
// and restores it in `finally` — safe to re-run.
//
// Run: node data/tests/refresh-after-execute.test.mjs

import dotenv from 'dotenv';
import assert from 'node:assert/strict';
dotenv.config();

const { default: executeHandler } = await import('../../api/execute.js');
const { default: profileHandler } = await import('../../api/profile.js');
const { default: alertHandler   } = await import('../../api/pending-alert.js');

function mockRes() {
  let _status = 200, _body = null;
  return {
    setHeader() {},
    status(c) { _status = c; return this; },
    json(b)   { _body = b;   return this; },
    end()     { return this; },
    get _statusCode() { return _status; },
    get _body()       { return _body; },
  };
}
async function call(handler, req) {
  const res = mockRes();
  await handler({ method: 'GET', query: {}, body: null, headers: {}, ...req }, res);
  return { status: res._statusCode, body: res._body };
}

const WALLET   = '0x9297C619fEd4C0E71a922E069cE82121779856D3';
const SYNTH_TX = '0x' + 'a'.repeat(64);
const STALE = {
  USDY:  { balance: 0.01,   usdValue: 0.01, apy: 3.55 },
  mETH:  { balance: 0.0001, usdValue: 0.20, apy: 2.06 },
  cmETH: { balance: 0,      usdValue: 0,    apy: 2.31 },
};

console.log('REGRESSION: positions must refresh after /api/execute records a swap');
console.log('  wallet:', WALLET);
console.log();

console.log('1. snapshotting live profile + alert (for restore)…');
const origProfile = (await call(profileHandler, { method: 'GET' })).body;
const origAlert   = (await call(alertHandler,   { method: 'GET' })).body;
if (!origAlert) {
  console.error('SETUP FAIL: no pending alert in Redis — test needs an alert to mark approved.');
  console.error('Run the agent once to generate one, then retry.');
  process.exit(2);
}
console.log('   profile snapshot ok (' + Object.keys(origProfile.positions || {}).length + ' assets, USDY=' + (origProfile.positions?.USDY?.balance ?? 'n/a') + ')');
console.log('   alert snapshot ok (' + origAlert.alertType + ', approved=' + origAlert.approved + ')');

let passed = false;
let failReason = '';
try {
  console.log('2. setting stale positions in profile (USDY=0.01, mETH=0.0001)…');
  await call(profileHandler, {
    method: 'POST',
    body: { positions: STALE, userPositionUSD: 0.21, lastSyncSource: 'test-setup' },
  });

  console.log('3. marking alert approved (clearing any executed flag)…');
  await call(alertHandler, {
    method: 'POST',
    body: {
      ...origAlert,
      approved: true,
      executed: false,
      executionTxHash: null,
      executionAggregator: null,
      executionFromUSD: null,
      executionToUSD: null,
      executionSwapCost: null,
    },
  });

  console.log('4. POST /api/execute with synthetic tx + walletAddress…');
  const r = await call(executeHandler, {
    method: 'POST',
    body: { txHash: SYNTH_TX, source: 'test', walletAddress: WALLET },
  });
  assert.equal(r.status, 200, `/api/execute returned ${r.status} (body=${JSON.stringify(r.body)})`);

  console.log('5. waiting 5s for refresh to complete…');
  await new Promise(r => setTimeout(r, 5000));

  console.log('6. reading profile back…');
  const after = (await call(profileHandler, { method: 'GET' })).body;
  const usdyBal = after?.positions?.USDY?.balance ?? 0;
  console.log('   profile.positions.USDY.balance = ' + usdyBal);

  // The actual assertions: not-stale, and within striking distance of chain truth (~56)
  assert.notEqual(usdyBal, 0.01, `expected refresh, profile still has stale USDY balance ${usdyBal}`);
  assert.ok(usdyBal > 10, `expected USDY balance > 10 (chain has ~56), got ${usdyBal}`);
  passed = true;
} catch (e) {
  failReason = e.message;
} finally {
  console.log('7. restoring original profile + alert…');
  await call(profileHandler, {
    method: 'POST',
    body: {
      positions: origProfile.positions,
      userPositionUSD: origProfile.userPositionUSD,
      lastSyncSource: 'test-cleanup',
    },
  });
  await call(alertHandler, { method: 'POST', body: origAlert });
}

console.log();
if (passed) {
  console.log('✅ PASS — /api/execute refreshed positions from chain');
  process.exit(0);
} else {
  console.log('❌ FAIL — ' + failReason);
  process.exit(1);
}
