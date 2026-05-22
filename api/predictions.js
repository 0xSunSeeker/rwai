import { Redis } from '@upstash/redis';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const KEY = 'predictions:list';
const CAP = 5000;
const PREDICTIONS_PATH = join(process.cwd(), 'data', 'predictions.jsonl');

function toDisplay(entry) {
  return {
    loggedAt: entry.loggedAt || entry.timestamp,
    txHash: entry.txHash || entry.anchorTxHash,
    usdyDirection: entry.usdyPrediction?.direction || 'unknown',
    usdyConfidence: entry.usdyPrediction?.confidence || 0,
    usdyReasoning: entry.usdyPrediction?.reasoning || '',
    methDirection: entry.methPrediction?.direction || 'unknown',
    methConfidence: entry.methPrediction?.confidence || 0,
    methReasoning: entry.methPrediction?.reasoning || '',
    yieldAtPrediction: entry.yieldAtPrediction || null,
    resolved: entry.resolved || false,
    outcome: entry.outcome || null,
  };
}

const parse = (e) => (typeof e === 'string' ? JSON.parse(e) : e);

// FALLBACK: deploy-time file (only used if Redis is empty/unreachable)
function fromFile(limit) {
  if (!existsSync(PREDICTIONS_PATH)) return { predictions: [], total: 0 };
  const lines = readFileSync(PREDICTIONS_PATH, 'utf8').trim().split('\n').filter(Boolean);
  const items = [];
  for (let i = lines.length - 1; i >= 0 && items.length < limit; i--) {
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.txHash || entry.anchorTxHash) items.push(toDisplay(entry));
    } catch {}
  }
  return { predictions: items, total: lines.length };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── WRITE PATH (agent dual-write) ──
  if (req.method === 'POST') {
    try {
      const body = req.body;
      // Bulk replace (resolution re-sync): { entries: [...] } in file order (oldest→newest)
      if (body && Array.isArray(body.entries)) {
        await redis.del(KEY);
        const newestFirst = [...body.entries].reverse();
        const CHUNK = 100;
        for (let i = 0; i < newestFirst.length; i += CHUNK) {
          await redis.rpush(KEY, ...newestFirst.slice(i, i + CHUNK));
        }
        await redis.ltrim(KEY, 0, CAP - 1);
        return res.status(200).json({ ok: true, mode: 'bulk', count: Math.min(body.entries.length, CAP) });
      }
      // Single new prediction → push to head, trim to cap
      if (!body || (!body.loggedAt && !body.timestamp)) {
        return res.status(400).json({ error: 'Invalid prediction entry' });
      }
      await redis.lpush(KEY, body);
      await redis.ltrim(KEY, 0, CAP - 1);
      return res.status(200).json({ ok: true, mode: 'single' });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=15');
  const limit = parseInt(req.query.limit) || 10;

  try {
    const raw = await redis.lrange(KEY, 0, -1); // index 0 = newest
    if (raw && raw.length) {
      const items = [];
      for (const e of raw) {
        if (items.length >= limit) break;
        const entry = parse(e);
        if (entry && (entry.txHash || entry.anchorTxHash)) items.push(toDisplay(entry));
      }
      return res.status(200).json({ predictions: items, total: raw.length });
    }
  } catch (err) {
    // fall through to file
  }
  return res.status(200).json(fromFile(limit));
}
