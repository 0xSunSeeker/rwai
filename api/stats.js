import { Redis } from '@upstash/redis';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const KEY = 'predictions:list';
const PREDICTIONS_PATH = join(process.cwd(), 'data', 'predictions.jsonl');

// Accuracy counts USDY + mETH only. cmETH is excluded: it's a derived metric and
// the APY formula changed mid-stream (compounding → +0.25% flat), making historical
// comparisons invalid.
function computeStats(parsed) {
  const total = parsed.length;
  const anchored = parsed.filter(p => p.txHash || p.anchorTxHash).length;
  const resolvedEntries = parsed.filter(p => p.resolved === true);

  if (resolvedEntries.length === 0) {
    return { accuracy: null, total, anchored, resolved: 0, usdyAccuracy: null, methAccuracy: null };
  }

  let correct = 0, totalCalls = 0;
  let usdyCorrect = 0, usdyTotal = 0;
  let methCorrect = 0, methTotal = 0;

  resolvedEntries.forEach(p => {
    if (p.usdyPrediction) {
      totalCalls++; usdyTotal++;
      if (p.usdyPrediction.correct) { correct++; usdyCorrect++; }
    }
    if (p.methPrediction) {
      totalCalls++; methTotal++;
      if (p.methPrediction.correct) { correct++; methCorrect++; }
    }
  });

  return {
    accuracy: Math.round((correct / totalCalls) * 100),
    total,
    anchored,
    resolved: resolvedEntries.length,
    usdyAccuracy: usdyTotal > 0 ? Math.round((usdyCorrect / usdyTotal) * 100) : null,
    methAccuracy: methTotal > 0 ? Math.round((methCorrect / methTotal) * 100) : null,
  };
}

const parse = (e) => (typeof e === 'string' ? JSON.parse(e) : e);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');

  try {
    const raw = await redis.lrange(KEY, 0, -1);
    if (raw && raw.length) {
      const parsed = raw.map(parse).filter(Boolean);
      return res.status(200).json(computeStats(parsed));
    }
  } catch (err) {
    // fall through to file
  }

  // FALLBACK: deploy-time file
  if (!existsSync(PREDICTIONS_PATH)) {
    return res.status(200).json({ accuracy: null, total: 0, anchored: 0, resolved: 0, usdyAccuracy: null });
  }
  const lines = readFileSync(PREDICTIONS_PATH, 'utf8').trim().split('\n').filter(Boolean);
  const parsed = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return res.status(200).json(computeStats(parsed));
}
