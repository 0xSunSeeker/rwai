import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');

  const predictionsPath = join(process.cwd(), 'data', 'predictions.jsonl');

  if (!existsSync(predictionsPath)) {
    return res.status(200).json({ accuracy: null, total: 0, resolved: 0 });
  }

  try {
    const lines = readFileSync(predictionsPath, 'utf8')
      .trim().split('\n').filter(Boolean);

    const parsed = lines
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);

    const resolvedEntries = parsed.filter(p => p.resolved === true);

    if (resolvedEntries.length === 0) {
      return res.status(200).json({ accuracy: null, total: parsed.length, resolved: 0 });
    }

    const totalCalls = resolvedEntries.reduce((n, p) =>
      n + (p.cmethPrediction ? 3 : 2), 0);

    const correct = resolvedEntries.reduce((n, p) =>
      n + (p.usdyPrediction?.correct ? 1 : 0)
        + (p.methPrediction?.correct ? 1 : 0)
        + (p.cmethPrediction?.correct ? 1 : 0), 0);

    const accuracy = Math.round((correct / totalCalls) * 100);

    return res.status(200).json({
      accuracy,
      total: parsed.length,
      resolved: resolvedEntries.length,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
