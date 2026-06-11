import { Redis } from '@upstash/redis';
import { ethers } from 'ethers';
import { fetchTokenPrices } from '../src/prices.js';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const REDIS_KEY = 'rwai:pending-alert';
const PROFILE_KEY = 'rwai:profile';

const USDY_ADDR  = '0x5bE26527e817998A7206475496fDE1E68957c5A6';
const METH_ADDR  = '0xcDA86A272531e8640cD7F1a92c01839911B90bb0';
const CMETH_ADDR = '0xE6829d9a7eE3040e1276Fa75293Bde931859e8fA';
const ERC20_ABI  = ['function balanceOf(address) view returns (uint256)'];
const MANTLE_RPC = process.env.MANTLE_RPC || 'https://rpc.mantle.xyz';

// Re-reads on-chain balances for `walletAddress` and merges into the Redis
// profile (preserves tier/sensitivity/etc.). Awaited so Vercel doesn't kill
// the function before it completes, but wrapped in try/catch by the caller so
// a refresh failure never blocks the swap-recorded response.
async function refreshProfilePositions(walletAddress) {
  if (!walletAddress || !/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
    console.warn('[execute] no/invalid walletAddress, skipping position refresh');
    return;
  }
  const provider = new ethers.JsonRpcProvider(MANTLE_RPC);
  const [usdyRaw, methRaw, cmethRaw] = await Promise.all([
    new ethers.Contract(USDY_ADDR,  ERC20_ABI, provider).balanceOf(walletAddress),
    new ethers.Contract(METH_ADDR,  ERC20_ABI, provider).balanceOf(walletAddress),
    new ethers.Contract(CMETH_ADDR, ERC20_ABI, provider).balanceOf(walletAddress),
  ]);
  const { usdy: usdyPrice, meth: methPrice, cmeth: cmethPrice } = await fetchTokenPrices();
  const usdyBal  = parseFloat(ethers.formatUnits(usdyRaw,  18));
  const methBal  = parseFloat(ethers.formatUnits(methRaw,  18));
  const cmethBal = parseFloat(ethers.formatUnits(cmethRaw, 18));
  const positions = {
    USDY:  { balance: usdyBal,  usdValue: usdyBal  * usdyPrice, apy: 3.55 },
    mETH:  { balance: methBal,  usdValue: methBal  * methPrice, apy: 2.06 },
    cmETH: { balance: cmethBal, usdValue: cmethBal * cmethPrice, apy: 2.31 },
  };
  const total = positions.USDY.usdValue + positions.mETH.usdValue + positions.cmETH.usdValue;

  const raw = await redis.get(PROFILE_KEY);
  const current = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
  const merged = {
    ...current,
    positions,
    userPositionUSD: total,
    lastSyncSource: 'execute-refresh',
    lastUpdated: Date.now(),
  };
  await redis.set(PROFILE_KEY, JSON.stringify(merged));
  console.log(`[execute] positions refreshed for ${walletAddress}: USDY=${usdyBal.toFixed(4)} mETH=${methBal.toFixed(6)} cmETH=${cmethBal.toFixed(6)}`);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { txHash, source, aggregator, fromAmountUSD, toAmountUSD, swapCost, walletAddress } = req.body;
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
    alert.executionAggregator = aggregator || null;
    alert.executionFromUSD = fromAmountUSD || null;
    alert.executionToUSD = toAmountUSD || null;
    alert.executionSwapCost = swapCost || null;

    await redis.set(REDIS_KEY, JSON.stringify(alert));

    // Refresh on-chain positions so the dashboard/agent see post-swap reality
    // immediately. Failure here never blocks the response — the tx already
    // executed; surface the error in logs only.
    try {
      await refreshProfilePositions(walletAddress);
    } catch (err) {
      console.warn('[execute] position refresh failed (continuing):', err.message);
    }

    return res.status(200).json({ ok: true, txHash });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
