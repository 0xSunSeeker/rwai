import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const PREDICTIONS_PATH = join(process.cwd(), 'data', 'predictions.jsonl');

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=15');

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!existsSync(PREDICTIONS_PATH)) {
    return res.status(200).json({ predictions: [] });
  }

  try {
    const lines = readFileSync(PREDICTIONS_PATH, 'utf8').trim().split('\n').filter(Boolean);
    const limit = parseInt(req.query.limit) || 10;

    const items = [];
    for (let i = lines.length - 1; i >= 0 && items.length < limit; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.txHash || entry.anchorTxHash) {
          items.push({
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
          });
        }
      } catch {}
    }

    return res.status(200).json({ predictions: items, total: lines.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
