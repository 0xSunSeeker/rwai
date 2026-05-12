import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const BUNDLE_PATH = join(process.cwd(), 'data', 'pendingAlert.json');
const TMP_PATH    = '/tmp/pendingAlert.json';

export default function handler(req, res) {
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

      let current = null;
      for (const p of [TMP_PATH, BUNDLE_PATH]) {
        if (existsSync(p)) {
          try { current = JSON.parse(readFileSync(p, 'utf8')); break; } catch {}
        }
      }

      if (!current) return res.status(404).json({ error: 'No pending alert' });

      const updated = {
        ...current,
        sent: true,
        ...(action === 'approve' ? { approved: true } : { dismissed: true }),
        respondedAt: Date.now(),
        respondedVia: 'web',
      };

      writeFileSync(TMP_PATH, JSON.stringify(updated, null, 2));
      return res.status(200).json(updated);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
