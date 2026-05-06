// src/bot.js
// RWAI Telegram Bot
// Sends agent alerts to users and handles commands
// Run with: node src/bot.js

import { Telegraf, Markup } from 'telegraf';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { generateExplanation, generateInsight } from './promptEngine.js';
import { logDecision } from './reputation.js';
import { fetchYieldData, shouldAlert } from './dataFetcher.js';
import dotenv from 'dotenv';
dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

function escapeMarkdown(text) {
  // Only escape the characters that actually break Telegram formatting
  return text.replace(/[*_`\[]/g, '\\$&');
}


// ─── USER PROFILE ─────────────────────────────────────────────────────────────
const PROFILE_PATH = './data/userProfile.json';

const DEFAULT_PROFILE = {
  userPositionUSD: 4200,
  userTier: 'Propose and Confirm',
  tierCode: 2,
  priorDecisions: 'Approved 2 similar USDY to mETH shifts in Q1 2026',
  agentAccuracy: '73% accurate over 24 predictions',
};

function loadProfile() {
  if (existsSync(PROFILE_PATH)) {
    try { return { ...DEFAULT_PROFILE, ...JSON.parse(readFileSync(PROFILE_PATH, 'utf8')) }; } catch {}
  }
  return { ...DEFAULT_PROFILE };
}

function saveProfile(updates) {
  const current = loadProfile();
  const updated = { ...current, ...updates };
  writeFileSync(PROFILE_PATH, JSON.stringify(updated, null, 2));
  return updated;
}

// Use loadProfile() everywhere instead of the static TEST_USER
const TEST_USER = loadProfile();

// ─── HELPER: get latest yield data ───────────────────────────────────────────
async function getYieldSnapshot() {
  const data = await fetchYieldData();
  return data;
}

// ─── /start ──────────────────────────────────────────────────────────────────
bot.start(async (ctx) => {
  const name = ctx.from.first_name || 'there';
  await ctx.reply(
    `👋 Hey ${name}! I'm RWAI — your autonomous RWA yield agent on Mantle.\n\n` +
    `I monitor your USDY and mETH positions 24/7, explain yield changes in plain English, and propose rebalances when the math makes sense.\n\n` +
    `Here's what I can do:\n` +
    `/status — your current yield snapshot\n` +
    `/compare — USDY vs mETH right now\n` +
    `/explain — what is USDY or mETH?\n` +
    `/history — recent agent decisions\n` +
    `/setup — choose your delegation tier\n\n` +
    `I'll message you automatically when something worth knowing happens. 🟢`
  );
});

// ─── /setup ──────────────────────────────────────────────────────────────────
bot.command('setup', async (ctx) => {
  const profile = loadProfile();
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
  saveProfile({ userTier: 'Watch Only', tierCode: 1 });
  await ctx.reply(
    `👁 *Tier 1 — Watch Only activated*\n\n` +
    `I'll alert you when yields shift meaningfully, but won't propose any actions. You stay fully in control.\n\n` +
    `Run /setup anytime to change this.`,
    { parse_mode: 'Markdown' }
  );
});

bot.action('tier_2', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  saveProfile({ userTier: 'Propose and Confirm', tierCode: 2 });
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

// ─── /status ─────────────────────────────────────────────────────────────────
bot.command('status', async (ctx) => {
  await ctx.reply('📡 Fetching live yield data...');

  try {
    const profile = loadProfile();
    const data = await getYieldSnapshot();
    const usdyYield = Number(data.usdyCurrentAPY);
    const methYield = Number(data.methCurrentAPR);
    const spread = (usdyYield - methYield).toFixed(2);
    const spreadDir = data.usdyCurrentAPY > data.methCurrentAPR ? 'USDY leads' : 'mETH leads';
    const insight = await generateInsight(usdyYield, methYield, Math.abs(Number(spread)).toFixed(2));
    const safeInsight = escapeMarkdown(insight);
    let anchorLine = '_On-chain anchor unavailable right now_';
    try {
      const anchor = await logDecision(Math.abs(Number(spread)).toFixed(2), insight);
      if (anchor?.explorerUrl) anchorLine = `[View on Explorer](${anchor.explorerUrl})`;
    } catch (anchorErr) {
      console.warn('On-chain anchor failed:', anchorErr.message);
    }

    const positionUsdy = profile.userPositionUSD;
    const annualYield = (positionUsdy * data.usdyCurrentAPY / 100).toFixed(0);

    await ctx.reply(
      `📊 *RWAI Status — ${new Date().toLocaleDateString('en-GB')}*\n\n` +
      `*USDY* — ${data.usdyCurrentAPY}% APY\n` +
      `*mETH* — ${data.methCurrentAPR}% APR${data.methAprFromRate ? ` _(rate-derived: ${data.methAprFromRate}%)_` : ''}\n` +
      `*Spread* — ${Math.abs(spread)}% (${spreadDir})\n\n` +
      `*Your position:* $${positionUsdy.toLocaleString()} USDY\n` +
      `*Est. annual yield:* $${annualYield}\n` +
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
  await ctx.reply('⚖️ Comparing USDY vs mETH...');

  try {
    const profile = loadProfile();
    const data = await getYieldSnapshot();
    const spread = Math.abs(data.usdyCurrentAPY - data.methCurrentAPR).toFixed(2);
    const winner = data.usdyCurrentAPY > data.methCurrentAPR ? 'USDY' : 'mETH';
    const annualDiff = (profile.userPositionUSD * spread / 100).toFixed(0);

    await ctx.reply(
      `⚖️ *USDY vs mETH — Right Now*\n\n` +
      `USDY: *${data.usdyCurrentAPY}%* APY — stable dollar value, T-bill backed, no price risk\n` +
      `mETH: *${data.methCurrentAPR}%* APR — higher potential, ETH price exposure\n\n` +
      `*Current winner:* ${winner} by ${spread}%\n` +
      `*On your $${profile.userPositionUSD.toLocaleString()}:* switching would change your annual yield by ~$${annualDiff}\n\n` +
      `${spread > 1.5 ? '🔔 Spread is wide enough that a rebalance is worth considering.' : '✅ Spread is within normal range. No action needed.'}`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    await ctx.reply('⚠️ Could not fetch comparison data right now.');
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
  } else {
    await ctx.reply(
      `What would you like me to explain?\n\n` +
      `/explain USDY — what is USDY and how does it earn?\n` +
      `/explain mETH — what is mETH and how does it earn?`
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

    // Accuracy: count resolved predictions only
    const resolved = all.filter(p => p.resolved);
    const totalCalls  = resolved.length * 2; // USDY + mETH per prediction
    const correctCalls = resolved.reduce((n, p) =>
      n + (p.usdyPrediction.correct ? 1 : 0) + (p.methPrediction.correct ? 1 : 0), 0);
    const accuracy = totalCalls > 0
      ? Math.round((correctCalls / totalCalls) * 100)
      : null;

    // Show last 5 predictions (newest first)
    const recent = [...all].reverse().slice(0, 5);

    let msg = `📊 *RWAI Prediction Track Record*\n\n`;

    if (accuracy !== null) {
      msg += `*Agent accuracy: ${accuracy}% over ${resolved.length} resolved prediction${resolved.length === 1 ? '' : 's'}*\n`;
      msg += `_(${correctCalls}/${totalCalls} correct calls — USDY + mETH combined)_\n\n`;
    } else {
      msg += `_Accuracy score builds after 24h — ${all.length} prediction${all.length === 1 ? '' : 's'} logged so far_\n\n`;
    }

    msg += `*Last ${recent.length} predictions:*\n\n`;

    recent.forEach(p => {
      const date = new Date(p.loggedAt).toLocaleDateString('en-GB');
      const time = new Date(p.loggedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      const usdyMark = p.resolved ? (p.usdyPrediction.correct ? '✅' : '❌') : '⏳';
      const methMark = p.resolved ? (p.methPrediction.correct ? '✅' : '❌') : '⏳';
      msg += `*${date} ${time}*\n`;
      msg += `${usdyMark} USDY: ${p.usdyPrediction.direction} (${p.usdyPrediction.confidence}%)`;
      if (p.resolved) msg += ` → actual: ${p.usdyPrediction.actualDirection}`;
      msg += `\n`;
      msg += `${methMark} mETH: ${p.methPrediction.direction} (${p.methPrediction.confidence}%)`;
      if (p.resolved) msg += ` → actual: ${p.methPrediction.actualDirection}`;
      msg += `\n\n`;
    });

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err) {
    await ctx.reply('Could not load history: ' + err.message);
  }
});

// ─── FREE TEXT: Ask RWAI anything ────────────────────────────────────────────
bot.on('text', async (ctx) => {
  const question = ctx.message.text;

  // Skip if it's a command
  if (question.startsWith('/')) return;

  await ctx.reply('🤔 Thinking...');

  try {
    const yieldData = await getYieldSnapshot();
    const explanation = await generateExplanation(yieldData, {
      ...loadProfile(),
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
    if (!existsSync('./data/pendingAlert.json')) return;

    const alert = JSON.parse(readFileSync('./data/pendingAlert.json', 'utf8'));

    // Only send if not already handled
    if (alert.sent || alert.approved || alert.dismissed) return;

    // Send the alert
    await bot.telegram.sendMessage(chatId,
      `🔔 *RWAI Alert*\n\n${alert.explanation}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          Markup.button.callback('✅ Approve rebalance', 'approve'),
          Markup.button.callback('❌ Not now', 'dismiss'),
        ])
      }
    );

    // Mark as sent
    alert.sent = true;
    writeFileSync('./data/pendingAlert.json', JSON.stringify(alert, null, 2));

    console.log(`Alert sent to chat ${chatId}`);
  } catch (err) {
    console.warn('Alert check failed:', err.message);
  }
}

// ─── HANDLE APPROVE / DISMISS ─────────────────────────────────────────────────
bot.action('approve', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});

  try {
    const alert = JSON.parse(readFileSync('./data/pendingAlert.json', 'utf8'));
    const yieldSpread = Math.abs(alert.yieldData.usdyCurrentAPY - alert.yieldData.methCurrentAPR).toFixed(2);

    // Log the approved decision on-chain via ERC-8004
    const result = await logDecision(yieldSpread, alert.explanation);

    // Mark alert handled so agent writes a fresh one next time
    alert.approved = true;
    writeFileSync('./data/pendingAlert.json', JSON.stringify(alert, null, 2));

    const explorerLine = result?.explorerUrl
      ? `[View on Mantle Explorer](${result.explorerUrl})`
      : '_(on-chain anchor unavailable right now)_';

    await ctx.reply(
      `✅ *Rebalance approved and logged on-chain*\n\n` +
      `Yield spread at decision: ${yieldSpread}%\n\n` +
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
    const alert = JSON.parse(readFileSync('./data/pendingAlert.json', 'utf8'));
    alert.dismissed = true;
    writeFileSync('./data/pendingAlert.json', JSON.stringify(alert, null, 2));
  } catch {
    // Non-fatal — alert file may have been cleaned up already
  }

  await ctx.reply(
    `👍 Got it — no action taken. I'll keep watching and ping you if conditions change.`
  );
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
      setInterval(() => checkAndSendPendingAlert(MY_CHAT_ID), 2 * 60 * 1000);
      console.log('⏱️  Alert polling active — checking every 2 minutes');
      checkAndSendPendingAlert(MY_CHAT_ID);
      return;
    } catch (err) {
      console.warn(`Bot launch attempt ${i}/${retries} failed: ${err.message}`);
      if (i < retries) await new Promise(r => setTimeout(r, 3000 * i));
      else console.error('Bot failed to launch after all retries. Agent still running.');
    }
  }
}

launchBot();

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Export for use by agent.js
export { checkAndSendPendingAlert };
