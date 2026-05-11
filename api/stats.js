import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');

  const predictionsPath = join(process.cwd(), 'data', 'predictions.jsonl');

  if (!existsSync(predictionsPath)) {
    return res.status(200).json({ accuracy: null, total: 0, resolved: 0, usdyAccuracy: null });
  }

  try {
    const lines = readFileSync(predictionsPath, 'utf8')
      .trim().split('\n').filter(Boolean);

    const parsed = lines
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);

    const resolvedEntries = parsed.filter(p => p.resolved === true);

    if (resolvedEntries.length === 0) {
      return res.status(200).json({ accuracy: null, total: parsed.length, resolved: 0, usdyAccuracy: null });
    }

    // Accuracy counts USDY + mETH only.
    // cmETH is excluded: it's a derived metric and the APY formula changed
    // mid-stream (compounding → +0.25% flat), making historical comparisons invalid.
    let correct = 0, totalCalls = 0;
    let usdyCorrect = 0, usdyTotal = 0;
    let methCorrect = 0, methTotal = 0;

    resolvedEntries.forEach(p => {
      if (p.usdyPrediction) {
        totalCalls++;
        usdyTotal++;
        if (p.usdyPrediction.correct) { correct++; usdyCorrect++; }
      }
      if (p.methPrediction) {
        totalCalls++;
        methTotal++;
        if (p.methPrediction.correct) { correct++; methCorrect++; }
      }
    });

    const accuracy      = Math.round((correct      / totalCalls) * 100);
    const usdyAccuracy  = usdyTotal > 0 ? Math.round((usdyCorrect  / usdyTotal)  * 100) : null;
    const methAccuracy  = methTotal > 0 ? Math.round((methCorrect  / methTotal)  * 100) : null;

    return res.status(200).json({
      accuracy,
      total: parsed.length,
      resolved: resolvedEntries.length,
      usdyAccuracy,
      methAccuracy,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
