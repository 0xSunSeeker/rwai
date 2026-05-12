import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// On Vercel, /var/task is read-only. Use /tmp for writes (per-instance ephemeral).
// Reads check /tmp first (recently written this invocation chain), then the committed bundle file.
const BUNDLE_PATH = join(process.cwd(), 'data', 'userProfile.json');
const TMP_PATH    = '/tmp/userProfile.json';

const DEFAULT_PROFILE = {
  userPositionUSD: 0,
  userTier: 'Watch Only',
  tierCode: 1,
  alertSensitivity: 'balanced',
  priorDecisions: 'No prior decisions',
  agentAccuracy: '63% accurate over 91 predictions (USDY 100%)',
  walletAddress: null,
  positions: {},
  tier3Activated: false,
  tier3ApprovalTx: null,
  agentPaused: false,
  lastSyncSource: null,
  lastUpdated: null,
};

function readProfile() {
  for (const p of [TMP_PATH, BUNDLE_PATH]) {
    if (existsSync(p)) {
      try { return JSON.parse(readFileSync(p, 'utf8')); } catch {}
    }
  }
  return null;
}

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    try {
      const profile = readProfile();
      return res.status(200).json({ ...DEFAULT_PROFILE, ...(profile || {}) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const updates = req.body;
      const current = readProfile() || DEFAULT_PROFILE;

      const merged = {
        ...current,
        ...updates,
        lastSyncSource: updates.lastSyncSource || 'web',
        lastUpdated: Date.now(),
      };

      writeFileSync(TMP_PATH, JSON.stringify(merged, null, 2));
      return res.status(200).json(merged);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
