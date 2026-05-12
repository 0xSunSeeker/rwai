import { Redis } from '@upstash/redis';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const BUNDLE_PATH = join(process.cwd(), 'data', 'pendingAlert.json');
const REDIS_KEY = 'rwai:pending-alert';

async function readAlert() {
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

async function writeAlert(alert) {
  try {
    await redis.set(REDIS_KEY, JSON.stringify(alert));
    return true;
  } catch (err) {
    console.error('Redis write failed:', err.message);
    return false;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    try {
      const { action } = req.body;
      if (!['approve', 'dismiss'].includes(action)) {
        return res.status(400).json({ error: 'action must be approve or dismiss' });
      }

      const current = await readAlert();
      if (!current) return res.status(404).json({ error: 'No pending alert' });

      const updated = {
        ...current,
        sent: true,
        ...(action === 'approve' ? { approved: true } : { dismissed: true }),
        respondedAt: Date.now(),
        respondedVia: 'web',
      };

      const ok = await writeAlert(updated);
      if (!ok) return res.status(500).json({ error: 'Could not persist response' });
      return res.status(200).json(updated);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
