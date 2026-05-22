import { Redis } from '@upstash/redis';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const KEY = 'predictions:list';
const PREDICTIONS_PATH = join(process.cwd(), 'data', 'predictions.jsonl');

const parse = (e) => (typeof e === 'string' ? JSON.parse(e) : e);

function pick(entry) {
  return {
    found: true,
    txHash: entry.txHash || entry.anchorTxHash,
    loggedAt: entry.loggedAt || entry.timestamp,
    type: entry.cmethPrediction ? 'multi-asset prediction' : 'prediction',
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=15');

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const raw = await redis.lrange(KEY, 0, -1); // index 0 = newest
    if (raw && raw.length) {
      for (const e of raw) {
        const entry = parse(e);
        if (entry && (entry.txHash || entry.anchorTxHash)) return res.status(200).json(pick(entry));
      }
    }
  } catch (err) {
    // fall through to file
  }

  // FALLBACK: deploy-time file
  if (!existsSync(PREDICTIONS_PATH)) return res.status(200).json({ found: false });
  const lines = readFileSync(PREDICTIONS_PATH, 'utf8').trim().split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.txHash || entry.anchorTxHash) return res.status(200).json(pick(entry));
    } catch {}
  }
  return res.status(200).json({ found: false });
}
