import { Redis } from '@upstash/redis';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const BUNDLE_PATH = join(process.cwd(), 'data', 'userProfile.json');
const REDIS_KEY = 'rwai:profile';

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

async function readProfile() {
  try {
    const data = await redis.get(REDIS_KEY);
    if (data) return typeof data === 'string' ? JSON.parse(data) : data;
  } catch (err) {
    console.warn('Redis read failed:', err.message);
  }
  if (existsSync(BUNDLE_PATH)) {
    try { return JSON.parse(readFileSync(BUNDLE_PATH, 'utf8')); } catch {}
  }
  return null;
}

async function writeProfile(profile) {
  try {
    await redis.set(REDIS_KEY, JSON.stringify(profile));
    return true;
  } catch (err) {
    console.error('Redis write failed:', err.message);
    return false;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    try {
      const profile = await readProfile();
      return res.status(200).json({ ...DEFAULT_PROFILE, ...(profile || {}) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const updates = req.body;
      const current = (await readProfile()) || { ...DEFAULT_PROFILE };
      const merged = {
        ...current,
        ...updates,
        lastSyncSource: updates.lastSyncSource || 'web',
        lastUpdated: Date.now(),
      };
      const ok = await writeProfile(merged);
      if (!ok) return res.status(500).json({ error: 'Could not persist profile' });
      return res.status(200).json(merged);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
