import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const PREDICTIONS_PATH = join(process.cwd(), 'data', 'predictions.jsonl');

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=15');

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!existsSync(PREDICTIONS_PATH)) {
    return res.status(200).json({ found: false });
  }

  try {
    const lines = readFileSync(PREDICTIONS_PATH, 'utf8').trim().split('\n').filter(Boolean);

    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.txHash || entry.anchorTxHash) {
          return res.status(200).json({
            found: true,
            txHash: entry.txHash || entry.anchorTxHash,
            loggedAt: entry.loggedAt || entry.timestamp,
            type: entry.cmethPrediction ? 'multi-asset prediction' : 'prediction',
          });
        }
      } catch {}
    }

    return res.status(200).json({ found: false });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
