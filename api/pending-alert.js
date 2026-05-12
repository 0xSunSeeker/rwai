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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    try {
      const alert = await readAlert();
      return res.status(200).json(alert);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
