import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const REDIS_KEY = 'rwai:pending-alert';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { txHash, source } = req.body;
    if (!txHash || !txHash.match(/^0x[0-9a-fA-F]{64}$/)) {
      return res.status(400).json({ error: 'Invalid txHash' });
    }

    const raw = await redis.get(REDIS_KEY);
    if (!raw) return res.status(404).json({ error: 'No pending alert' });
    const alert = typeof raw === 'string' ? JSON.parse(raw) : raw;

    if (!alert.approved) {
      return res.status(400).json({ error: 'Alert not approved yet' });
    }

    alert.executed = true;
    alert.executionTxHash = txHash;
    alert.executedAt = Date.now();
    alert.executionSource = source || 'web';

    await redis.set(REDIS_KEY, JSON.stringify(alert));
    return res.status(200).json({ ok: true, txHash });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
