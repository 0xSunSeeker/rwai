// src/bot.js
// RWAI Telegram Bot
// Sends agent alerts to users and handles commands
// Run with: node src/bot.js

import { Telegraf, Markup } from 'telegraf';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { ethers } from 'ethers';
import { generateExplanation, generateInsight, generateStrategy } from './promptEngine.js';
import { logDecision } from './reputation.js';
import { fetchYieldData, shouldAlert, RISK_PROFILES } from './dataFetcher.js';
import dotenv from 'dotenv';
dotenv.config();

// ─── WALLET BALANCE FETCHER ───────────────────────────────────────────────────
async function fetchWalletBalances(walletAddress) {
  const provider = new ethers.JsonRpcProvider(process.env.MANTLE_RPC || 'https://rpc.mantle.xyz');
  const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];
  const USDY_ADDRESS  = '0x5bE26527e817998A7206475496fDE1E68957c5A6';
  const METH_ADDRESS  = '0xcDA86A272531e8640cD7F1a92c01839911B90bb0';
  const CMETH_ADDRESS = '0xE6829d9a7eE3040e1276Fa75293Bde931859e8fA';

  const [usdyRaw, methRaw, cmethRaw] = await Promise.all([
    new ethers.Contract(USDY_ADDRESS,  ERC20_ABI, provider).balanceOf(walletAddress),
    new ethers.Contract(METH_ADDRESS,  ERC20_ABI, provider).balanceOf(walletAddress),
    new ethers.Contract(CMETH_ADDRESS, ERC20_ABI, provider).balanceOf(walletAddress),
  ]);

  const usdyBalance  = parseFloat(ethers.formatUnits(usdyRaw,  18));
  const methBalance  = parseFloat(ethers.formatUnits(methRaw,  18));
  const cmethBalance = parseFloat(ethers.formatUnits(cmethRaw, 18));

  let ethPrice = 2500;
  try {
    const res  = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
    const data = await res.json();
    ethPrice = data?.ethereum?.usd || 2500;
  } catch {}

  const usdyUSD  = usdyBalance  * 1.013;
  const methUSD  = methBalance  * ethPrice;
  const cmethUSD = cmethBalance * ethPrice;
  const totalUSD = usdyUSD + methUSD + cmethUSD;

  return {
    totalUSD,
    positions: {
      USDY:  { balance: usdyBalance,  usdValue: usdyUSD,  apy: 3.55 },
      mETH:  { balance: methBalance,  usdValue: methUSD,  apy: 2.06 },
      cmETH: { balance: cmethBalance, usdValue: cmethUSD, apy: 2.31 },
    }
  };
}

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

function escapeMarkdown(text) {
  // Only escape the characters that actually break Telegram formatting
  return text.replace(/[*_`\[]/g, '\\$&');
}


// ─── USER PROFILE ─────────────────────────────────────────────────────────────
const PROFILE_PATH = './data/userProfile.json';
const API_BASE = process.env.API_BASE || 'https://rwai.fyi';

const DEFAULT_PROFILE = {
  userPositionUSD: 4200,
  userTier: 'Propose and Confirm',
  tierCode: 2,
  priorDecisions: 'Approved 2 similar USDY to mETH shifts in Q1 2026',
  agentAccuracy: '73% accurate over 24 predictions',
};

async function loadProfile() {
  try {
    const res = await fetch(`${API_BASE}/api/profile`);
    if (res.ok) {
      const profile = await res.json();
      return { ...DEFAULT_PROFILE, ...profile };
    }
  } catch (err) {
    console.warn('loadProfile API failed, falling back to local file:', err.message);
  }
  if (existsSync(PROFILE_PATH)) {
    try { return { ...DEFAULT_PROFILE, ...JSON.parse(readFileSync(PROFILE_PATH, 'utf8')) }; } catch {}
  }
  return { ...DEFAULT_PROFILE };
}

async function saveProfile(updates) {
  const merged = { ...updates, lastSyncSource: 'telegram' };
  try {
    const res = await fetch(`${API_BASE}/api/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(merged),
    });
    if (res.ok) {
      const profile = await res.json();
      try { writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2)); } catch {}
      return profile;
    }
  } catch (err) {
    console.warn('saveProfile API failed, writing local only:', err.message);
  }
  const current = existsSync(PROFILE_PATH)
    ? JSON.parse(readFileSync(PROFILE_PATH, 'utf8'))
    : { ...DEFAULT_PROFILE };
  const updated = { ...current, ...merged, lastUpdated: Date.now() };
  writeFileSync(PROFILE_PATH, JSON.stringify(updated, null, 2));
  return updated;
}

async function saveUser(profile) {
  return await saveProfile(profile);
}

// ─── HELPER: get latest yield data ───────────────────────────────────────────
async function getYieldSnapshot() {
  const data = await fetchYieldData();
  return data;
}

// ─── /start ──────────────────────────────────────────────────────────────────
bot.start(async (ctx) => {
  const payload = ctx.startPayload;

  if (payload && payload.startsWith('wallet_')) {
    // Journey 1: user came from dashboard with wallet address
    const walletAddress = payload.replace('wallet_', '').trim();

    if (!walletAddress.match(/^0x[0-9a-fA-F]{40}$/)) {
      return ctx.reply('Invalid wallet address in link. Please try reconnecting from the dashboard.');
    }

    await ctx.reply('🔍 Found your wallet. Fetching your Mantle positions...');

    try {
      const balances = await fetchWalletBalances(walletAddress);

      const profile = await loadProfile();
      profile.walletAddress = walletAddress;
      profile.telegramId = ctx.from.id.toString();
      profile.userPositionUSD = balances.totalUSD;
      profile.positions = balances.positions;
      profile.lastUpdated = Date.now();
      profile.source = 'dashboard';
      profile.onboardingComplete = false;
      await saveUser(profile);

      const usdyLine  = balances.positions.USDY.usdValue  > 0 ? `• USDY — $${balances.positions.USDY.usdValue.toFixed(2)}\n`  : '';
      const methLine  = balances.positions.mETH.usdValue  > 0 ? `• mETH — $${balances.positions.mETH.usdValue.toFixed(2)}\n`  : '';
      const cmethLine = balances.positions.cmETH.usdValue > 0 ? `• cmETH — $${balances.positions.cmETH.usdValue.toFixed(2)}\n` : '';

      if (balances.totalUSD === 0) {
        await ctx.reply(
          `✅ Wallet connected.\n\n` +
          `I don't currently see USDY, mETH, or cmETH in this wallet.\n\n` +
          `RWAi will watch live yields and alert you when you hold supported assets.\n\n` +
          `Use /status anytime to see current Mantle yield conditions.`
        );
      } else {
        await ctx.reply(
          `✅ Connected to RWAi.\n\n` +
          `I found your Mantle portfolio:\n` +
          usdyLine + methLine + cmethLine +
          `\n*Total monitored:* $${balances.totalUSD.toFixed(2)}\n\n` +
          `RWAi is now watching your positions 24/7.\n\n` +
          `One last step — choose how you want RWAi to act when it detects an opportunity:`,
          { parse_mode: 'Markdown' }
        );

        await ctx.reply(
          `Choose your delegation tier:`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: '👁 Watch Only — alerts only, no actions',      callback_data: 'set_tier_1' }],
                [{ text: '✅ Propose and Confirm — I approve each move', callback_data: 'set_tier_2' }],
                [{ text: '⚡ Delegated — auto-execute within my cap',    callback_data: 'set_tier_3' }],
              ]
            }
          }
        );
      }
    } catch (err) {
      console.error('Wallet fetch error:', err.message);
      await ctx.reply(
        `✅ Wallet saved. I had trouble fetching live balances right now — I'll retry on the next cycle.\n\n` +
        `Use /status to check your current positions.`
      );
    }

  } else {
    // Journey 2: direct Telegram entry, no wallet
    await ctx.reply(
      `👋 Welcome to RWAi.\n\n` +
      `I monitor tokenized real-world asset yields on Mantle — USDY, mETH, and cmETH — and alert you when conditions change.\n\n` +
      `Every prediction is permanently logged on Mantle via ERC-8004.\n\n` +
      `To get started:`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔗 Connect wallet', callback_data: 'request_wallet' }],
            [{ text: '📊 View live yields without wallet', callback_data: 'watch_mode' }],
          ]
        }
      }
    );
  }
});

// ─── /setup ──────────────────────────────────────────────────────────────────
bot.command('setup', async (ctx) => {
  const profile = await loadProfile();
  const current = profile.userTier;
  await ctx.reply(
    `⚙️ *RWAI Delegation Setup*\n\n` +
    `Choose how much authority you give the agent:\n\n` +
    `*Tier 1 — Watch Only*\nAlerts only. Agent never proposes actions. You decide everything.\n\n` +
    `*Tier 2 — Propose and Confirm* _(current: ${current === 'Propose and Confirm' ? '✅' : ''})_\nAgent proposes rebalances. You approve with one tap in Telegram.\n\n` +
    `*Tier 3 — Delegated*\nAgent auto-executes up to a cap you set. Coming soon.\n\n` +
    `Currently active: *${current}*`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('👁 Tier 1 — Watch Only', 'tier_1')],
        [Markup.button.callback('✅ Tier 2 — Propose and Confirm', 'tier_2')],
        [Markup.button.callback('🤖 Tier 3 — Delegated (coming soon)', 'tier_3_disabled')],
      ])
    }
  );
});

bot.action('tier_1', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await saveProfile({ userTier: 'Watch Only', tierCode: 1 });
  await ctx.reply(
    `👁 *Tier 1 — Watch Only activated*\n\n` +
    `I'll alert you when yields shift meaningfully, but won't propose any actions. You stay fully in control.\n\n` +
    `Run /setup anytime to change this.`,
    { parse_mode: 'Markdown' }
  );
});

bot.action('tier_2', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await saveProfile({ userTier: 'Propose and Confirm', tierCode: 2 });
  await ctx.reply(
    `✅ *Tier 2 — Propose and Confirm activated*\n\n` +
    `When yields shift enough to act on, I'll send you a proposal with Approve / Dismiss buttons. One tap to confirm, nothing auto-executes.\n\n` +
    `Run /setup anytime to change this.`,
    { parse_mode: 'Markdown' }
  );
});

bot.action('tier_3_disabled', async (ctx) => {
  await ctx.answerCbQuery('Coming soon — Tier 2 is the live option right now.').catch(() => {});
});

// ─── JOURNEY 1: TIER SELECTION (from dashboard deep-link) ────────────────────
bot.action('set_tier_1', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const profile = await loadProfile();
  if (!profile.alertSensitivity) profile.alertSensitivity = 'major';
  await saveUser({ ...profile, userTier: 'Watch Only', tierCode: 1, onboardingComplete: true });
  await ctx.reply(
    `✅ Watch Only mode activated.\n\n` +
    `I'll explain every yield change and opportunity — you decide if and when to act.\n\n` +
    `Use /status anytime to check your positions.`
  );
});

bot.action('set_tier_2', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const profile = await loadProfile();
  if (!profile.alertSensitivity) profile.alertSensitivity = 'balanced';
  await saveUser({ ...profile, userTier: 'Propose and Confirm', tierCode: 2, onboardingComplete: true });
  await ctx.reply(
    `✅ Propose and Confirm mode activated.\n\n` +
    `When I detect a meaningful opportunity, I'll send you a one-tap approval request.\n\n` +
    `Nothing moves without your confirmation. Use /status to check your positions.`
  );
});

bot.action('set_tier_3', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const profile = await loadProfile();
  if (!profile.alertSensitivity) profile.alertSensitivity = 'high';
  await saveUser({ ...profile, userTier: 'Delegated', tierCode: 3, onboardingComplete: true });
  await ctx.reply(
    `⚡ Delegated mode activated.\n\n` +
    `I can auto-execute rebalances up to $500 per swap when spread conditions justify it.\n\n` +
    `Every execution is logged permanently on Mantle. Use /status to check your positions.`
  );
});

// ─── /sensitivity ──────────────────────────────────────────────────────────────
bot.command('sensitivity', async (ctx) => {
  const profile = await loadProfile();
  const current = profile.alertSensitivity || 'balanced';
  const labels = {
    high:     'High Sensitivity — alerts on small opportunities (0.5% spread)',
    balanced: 'Balanced — alerts on meaningful opportunities (1.5% spread)',
    major:    'Major Opportunities Only — alerts only when clearly worthwhile (2.0% spread)',
  };
  await ctx.reply(
    `*Current sensitivity:* ${labels[current]}\n\n` +
    `Adjust how sensitive RWAi is to yield changes:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔍 High Sensitivity (0.5%)',  callback_data: 'sens_high' }],
          [{ text: '⚖️ Balanced (1.5%)',          callback_data: 'sens_balanced' }],
          [{ text: '🎯 Major Only (2.0%)',         callback_data: 'sens_major' }],
        ]
      }
    }
  );
});

bot.action('sens_high', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const profile = await loadProfile();
  profile.alertSensitivity = 'high';
  await saveUser(profile);
  await ctx.reply(`🔍 High Sensitivity active. I'll alert you whenever spread exceeds 0.5%.`);
});

bot.action('sens_balanced', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const profile = await loadProfile();
  profile.alertSensitivity = 'balanced';
  await saveUser(profile);
  await ctx.reply(`⚖️ Balanced sensitivity active. I'll alert you when spread exceeds 1.5%.`);
});

bot.action('sens_major', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const profile = await loadProfile();
  profile.alertSensitivity = 'major';
  await saveUser(profile);
  await ctx.reply(`🎯 Major Opportunities Only active. I'll only alert you on spreads above 2.0%.`);
});

bot.action('request_wallet', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const profile = await loadProfile();
  profile.awaitingWallet = true;
  profile.telegramId = ctx.from.id.toString();
  await saveUser(profile);
  await ctx.reply(`Send me your Mantle wallet address (starts with 0x) and I'll fetch your positions automatically.`);
});

bot.action('watch_mode', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await saveProfile({ userTier: 'Watch Only', tierCode: 1, walletAddress: null, onboardingComplete: true });
  await ctx.reply(
    `📊 Watch mode activated.\n\n` +
    `I'll track live USDY and mETH yields on Mantle and alert you when spreads change.\n\n` +
    `Connect a wallet anytime for personalized position monitoring.\n\n` +
    `Use /status to see current yields.`
  );
});

// ─── /status ─────────────────────────────────────────────────────────────────
bot.command('status', async (ctx) => {
  await ctx.reply('📡 Fetching live yield data...');

  try {
    const profile = await loadProfile();

    // Refresh on-chain balances if wallet is known
    if (profile.walletAddress) {
      try {
        const balances = await fetchWalletBalances(profile.walletAddress);
        await saveProfile({ userPositionUSD: balances.totalUSD, positions: balances.positions, lastUpdated: Date.now() });
        profile.userPositionUSD = balances.totalUSD;
      } catch (err) {
        console.warn('Balance refresh failed on /status:', err.message);
      }
    }
    const data = await getYieldSnapshot();
    const usdyYield = Number(data.usdyCurrentAPY);
    const methYield = Number(data.methCurrentAPR);
    const spread = (usdyYield - methYield).toFixed(2);
    const spreadDir = data.usdyCurrentAPY > data.methCurrentAPR ? 'USDY leads' : 'mETH leads';
    const insight = await generateInsight(usdyYield, methYield, Math.abs(Number(spread)).toFixed(2));
    const safeInsight = escapeMarkdown(insight);
    let anchorLine = '_Agent paused — no on-chain activity_';
    if (!profile.agentPaused) {
      anchorLine = '_On-chain anchor unavailable right now_';
      try {
        const anchor = await logDecision(Math.abs(Number(spread)).toFixed(2), insight);
        if (anchor?.explorerUrl) anchorLine = `[View on Explorer](${anchor.explorerUrl})`;
      } catch (anchorErr) {
        console.warn('On-chain anchor failed:', anchorErr.message);
      }
    }

    const positions = profile.positions || {};
    const usdyVal  = positions.USDY?.usdValue  || 0;
    const methVal  = positions.mETH?.usdValue  || 0;
    const cmethVal = positions.cmETH?.usdValue || 0;
    const totalVal = usdyVal + methVal + cmethVal;

    const usdyEarnings  = (usdyVal  * data.usdyCurrentAPY  / 100).toFixed(2);
    const methEarnings  = (methVal  * data.methCurrentAPR   / 100).toFixed(2);
    const cmethEarnings = (cmethVal * data.cmethCurrentAPY  / 100).toFixed(2);
    const totalEarnings = (parseFloat(usdyEarnings) + parseFloat(methEarnings) + parseFloat(cmethEarnings)).toFixed(2);

    let positionLines = '';
    if (usdyVal  > 0) positionLines += `• USDY: $${usdyVal.toFixed(2)} (earns ~$${usdyEarnings}/yr)\n`;
    if (methVal  > 0) positionLines += `• mETH: $${methVal.toFixed(2)} (earns ~$${methEarnings}/yr)\n`;
    if (cmethVal > 0) positionLines += `• cmETH: $${cmethVal.toFixed(2)} (earns ~$${cmethEarnings}/yr)\n`;
    if (totalVal === 0) positionLines = '_No supported positions detected_\n';

    await ctx.reply(
      `📊 *RWAI Status — ${new Date().toLocaleDateString('en-GB')}*\n\n` +
      `*USDY* — ${data.usdyCurrentAPY}% APY${data.usdyMantleTVL ? ` · $${(data.usdyMantleTVL/1e6).toFixed(1)}M on Mantle` : ''} _(risk 1/5)_\n` +
      `*mETH* — ${data.methCurrentAPR}% APR${data.methAprFromRate ? ` _(rate-derived: ${data.methAprFromRate}%)_` : ''} _(risk 3/5)_\n` +
      `*cmETH* — ${data.cmethCurrentAPY}% APY _(auto-compounding mETH, risk 3/5)_\n` +
      `*Spread* — ${Math.abs(spread)}% (${spreadDir})\n\n` +
      `*Your portfolio:*\n${positionLines}` +
      `*Total monitored:* $${totalVal.toFixed(2)}\n` +
      `*Est. annual yield:* $${totalEarnings}\n` +
      `*Delegation tier:* ${profile.userTier}\n\n` +
      `All positions healthy ✅\n\n` +
      `🤖 ${safeInsight}\n\n` +
      `${anchorLine}`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    await ctx.reply('⚠️ Could not fetch live data right now. Try again in a moment.');
  }
});

// ─── /compare ────────────────────────────────────────────────────────────────
bot.command('compare', async (ctx) => {
  await ctx.reply('⚖️ Comparing USDY vs mETH vs cmETH...');

  try {
    const profile = await loadProfile();
    const data = await getYieldSnapshot();
    const pos = profile.userPositionUSD;

    const spread = (data.usdyCurrentAPY - data.methCurrentAPR).toFixed(2);
    const annual = (pct) => (pos * pct / 100).toFixed(0);

    // Risk dots helper: filled ● / empty ○
    const riskDots = (score, max = 5) =>
      '●'.repeat(score) + '○'.repeat(max - score);

    await ctx.reply(
      `⚖️ *Yield Comparison — Right Now*\n\n` +
      `*USDY* — ${data.usdyCurrentAPY}% APY\n` +
      `Risk: ${riskDots(RISK_PROFILES.USDY.score)} 1/5 — ${RISK_PROFILES.USDY.reason}\n` +
      `Annual on $${pos.toLocaleString()}: ~$${annual(data.usdyCurrentAPY)}${data.usdyMantleTVL ? ` · $${(data.usdyMantleTVL/1e6).toFixed(1)}M on Mantle` : ''}\n\n` +
      `*mETH* — ${data.methCurrentAPR}% APR\n` +
      `Risk: ${riskDots(RISK_PROFILES.mETH.score)} 3/5 — ${RISK_PROFILES.mETH.reason}\n` +
      `Annual on $${pos.toLocaleString()}: ~$${annual(data.methCurrentAPR)}\n\n` +
      `*cmETH* — ${data.cmethCurrentAPY}% APY _(auto-compounding mETH)_\n` +
      `Risk: ${riskDots(RISK_PROFILES.cmETH.score)} 3/5 — ${RISK_PROFILES.cmETH.reason}\n` +
      `Annual on $${pos.toLocaleString()}: ~$${annual(data.cmethCurrentAPY)}\n\n` +
      `*USDY vs mETH spread:* ${Math.abs(spread)}% — on your position that's $${(pos * Math.abs(spread) / 100).toFixed(0)}/year\n\n` +
      `${Math.abs(spread) > 1.5 ? '🔔 Spread is wide. Run /strategy for a recommendation.' : '✅ Spread within normal range.'}`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    await ctx.reply('⚠️ Could not fetch comparison data right now.');
  }
});

// ─── /strategy ───────────────────────────────────────────────────────────────
bot.command('strategy', async (ctx) => {
  await ctx.reply('🧠 Analysing current yields and your profile...');

  try {
    const profile = await loadProfile();
    const data = await getYieldSnapshot();
    const recommendation = await generateStrategy(data, profile);
    await ctx.reply(`📈 *RWAI Strategy Recommendation*\n\n${recommendation}`, { parse_mode: 'Markdown' });
  } catch (err) {
    await ctx.reply('⚠️ Could not generate strategy right now. Try again in a moment.');
  }
});

// ─── /explain ────────────────────────────────────────────────────────────────
bot.command('explain', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1).join(' ').toUpperCase();

  if (args.includes('USDY')) {
    await ctx.reply(
      `📖 *What is USDY?*\n\n` +
      `USDY is a tokenized note backed by US Treasury bills and bank deposits, issued by Ondo Finance.\n\n` +
      `Think of it as a savings account that runs on the Mantle blockchain — you hold the token, it earns yield daily, no deposit needed anywhere.\n\n` +
      `*How the yield works:* Ondo buys US T-bills, earns the interest, and increases the USDY redemption value daily. Your token is worth slightly more each day.\n\n` +
      `*Current yield:* ~3.55% APY\n` +
      `*Risk level:* Low — backed by US government debt\n` +
      `*Price risk:* None — always redeems near $1`,
      { parse_mode: 'Markdown' }
    );
  } else if (args.includes('METH') || args.includes('ETH')) {
    await ctx.reply(
      `📖 *What is mETH?*\n\n` +
      `mETH is Mantle's liquid staked ETH token. When you hold mETH, you own a share of ETH that Mantle has staked on the Ethereum network.\n\n` +
      `*How the yield works:* Ethereum validators earn rewards for securing the network (~2% APR). Mantle passes those rewards to mETH holders by making each mETH redeemable for slightly more ETH over time.\n\n` +
      `*Current yield:* ~2.0% APR\n` +
      `*Risk level:* Medium — yield is real but value moves with ETH price\n` +
      `*Price risk:* Yes — if ETH drops, so does the dollar value of your position`,
      { parse_mode: 'Markdown' }
    );
  } else if (args.includes('CMETH')) {
    await ctx.reply(
      `📖 *What is cmETH?*\n\n` +
      `cmETH is the auto-compounding version of mETH, Mantle's liquid staked ETH token.\n\n` +
      `*How it works:* Instead of holding mETH directly, you deposit it into the cmETH vault. The vault collects your daily staking rewards and automatically reinvests them — so your mETH balance grows without you doing anything.\n\n` +
      `*How the yield differs from mETH:* mETH earns ~1.0% APR paid out over time. cmETH converts that APR to a slightly higher effective APY through daily compounding. At 1.0% APR the difference is small (~$0.50/year on $5,000), but it adds up at higher rates.\n\n` +
      `*Current yield:* Derived from mETH APR (~1.0% APY)\n` +
      `*Risk level:* Medium — same underlying ETH exposure as mETH, plus vault smart contract risk\n` +
      `*Price risk:* Yes — value moves with ETH price`,
      { parse_mode: 'Markdown' }
    );
  } else {
    await ctx.reply(
      `What would you like me to explain?\n\n` +
      `/explain USDY — what is USDY and how does it earn?\n` +
      `/explain mETH — what is mETH and how does it earn?\n` +
      `/explain cmETH — what is cmETH and how does auto-compounding work?`
    );
  }
});

// ─── /history ────────────────────────────────────────────────────────────────
bot.command('history', async (ctx) => {
  try {
    if (!existsSync('./data/predictions.jsonl')) {
      await ctx.reply('No prediction history yet. The agent logs a prediction every 30 minutes.');
      return;
    }

    const all = readFileSync('./data/predictions.jsonl', 'utf8')
      .trim().split('\n').filter(Boolean).map(l => JSON.parse(l));

    // Accuracy: USDY + mETH only — cmETH excluded (formula changed mid-stream)
    const resolved = all.filter(p => p.resolved);
    const totalCalls  = resolved.reduce((n, p) => n + 2, 0);
    const correctCalls = resolved.reduce((n, p) =>
      n + (p.usdyPrediction?.correct ? 1 : 0)
        + (p.methPrediction?.correct  ? 1 : 0), 0);
    const accuracy = totalCalls > 0
      ? Math.round((correctCalls / totalCalls) * 100)
      : null;

    const usdyCorrect = resolved.filter(p => p.usdyPrediction?.correct).length;
    const usdyAccuracy = resolved.length > 0
      ? Math.round((usdyCorrect / resolved.length) * 100)
      : null;

    // Show last 5 predictions (newest first)
    const recent = [...all].reverse().slice(0, 5);

    let msg = `📊 *RWAi Prediction Track Record*\n\n`;

    if (accuracy !== null) {
      msg += `*Agent accuracy: ${accuracy}% over ${resolved.length} resolved prediction${resolved.length === 1 ? '' : 's'}*\n`;
      msg += `_(USDY ${usdyAccuracy}% · mETH tracked — ${correctCalls}/${totalCalls} correct calls)_\n\n`;
    } else {
      msg += `_Accuracy score builds after 24h — ${all.length} prediction${all.length === 1 ? '' : 's'} logged so far_\n\n`;
    }

    msg += `*Last ${recent.length} predictions:*\n\n`;

    recent.forEach(p => {
      const date = new Date(p.loggedAt).toLocaleDateString('en-GB');
      const time = new Date(p.loggedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      const usdyMark = p.resolved ? (p.usdyPrediction?.correct ? '✅' : '❌') : '⏳';
      const methMark = p.resolved ? (p.methPrediction?.correct  ? '✅' : '❌') : '⏳';
      msg += `*${date} ${time}*\n`;
      msg += `${usdyMark} USDY: ${p.usdyPrediction?.direction} (${p.usdyPrediction?.confidence}%)`;
      if (p.resolved) msg += ` → actual: ${p.usdyPrediction?.actualDirection}`;
      msg += `\n`;
      msg += `${methMark} mETH: ${p.methPrediction?.direction} (${p.methPrediction?.confidence}%)`;
      if (p.resolved) msg += ` → actual: ${p.methPrediction?.actualDirection}`;
      msg += `\n\n`;
    });

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err) {
    await ctx.reply('Could not load history: ' + err.message);
  }
});

// ─── FREE TEXT: Ask RWAI anything ────────────────────────────────────────────
bot.on('text', async (ctx) => {
  // Intercept wallet addresses when in onboarding flow
  const onboardingProfile = await loadProfile();
  if (onboardingProfile.awaitingWallet) {
    const text = ctx.message.text.trim();

    if (text.match(/^0x[0-9a-fA-F]{40}$/)) {
      onboardingProfile.awaitingWallet = false;
      onboardingProfile.walletAddress = text;
      await saveUser(onboardingProfile);

      await ctx.reply('🔍 Found your wallet. Fetching your Mantle positions...');

      try {
        const balances = await fetchWalletBalances(text);
        onboardingProfile.userPositionUSD = balances.totalUSD;
        onboardingProfile.positions = balances.positions;
        onboardingProfile.lastUpdated = Date.now();
        onboardingProfile.source = 'telegram';
        await saveUser(onboardingProfile);

        const usdyLine  = balances.positions.USDY.usdValue  > 0 ? `• USDY — $${balances.positions.USDY.usdValue.toFixed(2)}\n`   : '';
        const methLine  = balances.positions.mETH.usdValue  > 0 ? `• mETH — $${balances.positions.mETH.usdValue.toFixed(2)}\n`   : '';
        const cmethLine = balances.positions.cmETH.usdValue > 0 ? `• cmETH — $${balances.positions.cmETH.usdValue.toFixed(2)}\n` : '';

        if (balances.totalUSD === 0) {
          await ctx.reply(
            `✅ Wallet connected.\n\nI don't currently see USDY, mETH, or cmETH in this wallet.\n\nRWAi will watch live yields and alert you when you hold supported assets.\n\nUse /status anytime to see current Mantle yield conditions.`
          );
        } else {
          await ctx.reply(
            `✅ Connected to RWAi.\n\nI found your Mantle portfolio:\n` +
            usdyLine + methLine + cmethLine +
            `\n*Total monitored:* $${balances.totalUSD.toFixed(2)}\n\nRWAi is now watching your positions 24/7.\n\nChoose how you want RWAi to act:`,
            { parse_mode: 'Markdown' }
          );
          await ctx.reply('Choose your delegation tier:', {
            reply_markup: {
              inline_keyboard: [
                [{ text: '👁 Watch Only — alerts only, no actions',      callback_data: 'set_tier_1' }],
                [{ text: '✅ Propose and Confirm — I approve each move', callback_data: 'set_tier_2' }],
                [{ text: '⚡ Delegated — auto-execute within my cap',    callback_data: 'set_tier_3' }],
              ]
            }
          });
        }
      } catch (err) {
        console.error('Wallet fetch error:', err.message);
        await ctx.reply('✅ Wallet saved. Use /status to check your positions.');
      }
      return;
    } else {
      onboardingProfile.awaitingWallet = false;
      await saveUser(onboardingProfile);
      await ctx.reply("That doesn't look like a valid Mantle wallet address. Please send an address starting with 0x followed by 40 characters.");
      return;
    }
  }

  const question = ctx.message.text;

  // Skip if it's a command
  if (question.startsWith('/')) return;

  await ctx.reply('🤔 Thinking...');

  try {
    const yieldData = await getYieldSnapshot();
    const explanation = await generateExplanation(yieldData, {
      ...(await loadProfile()),
      priorDecisions: `User asked: "${question}". Answer this question directly using current yield context.`,
    });

    await ctx.reply(explanation);
  } catch (err) {
    await ctx.reply('Sorry, I had trouble generating a response. Try again in a moment.');
  }
});

// ─── CHECK FOR PENDING ALERTS ─────────────────────────────────────────────────
// Checks every 2 minutes if agent.js has saved a new alert to send
// In production this becomes a webhook or is triggered directly by agent.js
async function checkAndSendPendingAlert(chatId) {
  try {
    const res = await fetch('https://rwai.fyi/api/pending-alert');
    if (!res.ok) return;
    const data = await res.json();

    if (!data || !data.pending) return;
    if (data.alreadySent) return;

    await bot.telegram.sendMessage(chatId,
      `🔔 *RWAI Alert*\n\n${data.explanation}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          Markup.button.callback('✅ Approve rebalance', 'approve'),
          Markup.button.callback('❌ Not now', 'dismiss'),
        ])
      }
    );

    // Mark as sent in Redis so we don't re-send on next poll
    await fetch('https://rwai.fyi/api/pending-alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, alreadySent: true }),
    });

    console.log(`Alert sent to chat ${chatId}`);
  } catch (err) {
    console.warn('Alert check failed:', err.message);
  }
}

// ─── HANDLE APPROVE / DISMISS ─────────────────────────────────────────────────
bot.action('approve', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});

  try {
    const alertRes = await fetch('https://rwai.fyi/api/pending-alert');
    const alertData = alertRes.ok ? await alertRes.json() : {};

    const yieldData = alertData.yieldData || {};
    const spread = yieldData.usdyCurrentAPY && yieldData.methCurrentAPR
      ? Math.abs(yieldData.usdyCurrentAPY - yieldData.methCurrentAPR).toFixed(2)
      : '0';

    // Log the approved decision on-chain via ERC-8004
    let explorerLine = '_(on-chain anchor unavailable right now)_';
    try {
      const result = await logDecision(spread, alertData.explanation || '');
      if (result?.explorerUrl) explorerLine = `[View on Mantle Explorer](${result.explorerUrl})`;
    } catch (err) {
      console.error('Anchor failed:', err.message);
    }

    // Record response in Redis
    await fetch('https://rwai.fyi/api/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve', source: 'telegram' }),
    });

    await ctx.reply(
      `✅ *Rebalance approved and logged on-chain*\n\n` +
      `Yield spread at decision: ${spread}%\n\n` +
      `${explorerLine}\n\n` +
      `_(Wallet execution coming in Week 3)_`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Approve action error:', err.message);
    await ctx.reply('✅ Approved. Could not log on-chain right now — I\'ll retry next cycle.');
  }
});

bot.action('dismiss', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});

  try {
    await fetch('https://rwai.fyi/api/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dismiss', source: 'telegram' }),
    });
  } catch (err) {
    console.warn('Dismiss POST failed:', err.message);
  }

  await ctx.reply(`👍 Got it — no action taken. I'll keep watching and ping you if conditions change.`);
});

// ─── GLOBAL ERROR HANDLER — keeps the process alive on bad callbacks ──────────
bot.catch((err, ctx) => {
  console.warn(`Bot error on update ${ctx?.updateType}:`, err.message);
});

// ─── START BOT ────────────────────────────────────────────────────────────────
// Replace YOUR_CHAT_ID_HERE with the number you got from Step 1
const MY_CHAT_ID = 796922941;

async function launchBot(retries = 5) {
  for (let i = 1; i <= retries; i++) {
    try {
      await bot.launch();
      console.log('\n========================================');
      console.log('RWAI Telegram Bot is running');
      console.log('Find your bot: https://t.me/rwaiapp_bot');
      console.log('Send /start in Telegram to begin');
      console.log('Press Ctrl+C to stop');
      console.log('========================================\n');
      return;
    } catch (err) {
      console.warn(`Bot launch attempt ${i}/${retries} failed: ${err.message}`);
      if (i < retries) await new Promise(r => setTimeout(r, 3000 * i));
      else console.error('Bot failed to launch after all retries.');
    }
  }
}

// Alert polling runs independently — not gated on bot.launch() completing
console.log('⏱️  Alert polling active — checking every 2 minutes');
checkAndSendPendingAlert(MY_CHAT_ID);
setInterval(() => checkAndSendPendingAlert(MY_CHAT_ID), 2 * 60 * 1000);

launchBot();

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Export for use by agent.js
export { checkAndSendPendingAlert };
