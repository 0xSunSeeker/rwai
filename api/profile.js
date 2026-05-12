import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const PROFILE_PATH = join(process.cwd(), 'data', 'userProfile.json');

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

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    try {
      if (!existsSync(PROFILE_PATH)) {
        return res.status(200).json(DEFAULT_PROFILE);
      }
      const data = readFileSync(PROFILE_PATH, 'utf8');
      const profile = JSON.parse(data);
      return res.status(200).json({ ...DEFAULT_PROFILE, ...profile });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const updates = req.body;
      let current = DEFAULT_PROFILE;

      if (existsSync(PROFILE_PATH)) {
        const data = readFileSync(PROFILE_PATH, 'utf8');
        current = JSON.parse(data);
      }

      const merged = {
        ...current,
        ...updates,
        lastSyncSource: updates.lastSyncSource || 'web',
        lastUpdated: Date.now(),
      };

      writeFileSync(PROFILE_PATH, JSON.stringify(merged, null, 2));
      return res.status(200).json(merged);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
