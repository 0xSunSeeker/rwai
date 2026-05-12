import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const BUNDLE_PATH = join(process.cwd(), 'data', 'pendingAlert.json');
const TMP_PATH    = '/tmp/pendingAlert.json';

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    for (const p of [TMP_PATH, BUNDLE_PATH]) {
      if (existsSync(p)) {
        try {
          const alert = JSON.parse(readFileSync(p, 'utf8'));
          return res.status(200).json(alert);
        } catch {}
      }
    }
    return res.status(200).json(null);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
