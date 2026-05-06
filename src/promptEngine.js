// src/promptEngine.js
// The brain of RWAI — takes yield data in, returns plain-English explanation
// and a structured prediction object ready for on-chain logging

import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
dotenv.config();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// RWAI's personality — injected into every Claude call
const RWAI_SYSTEM_PROMPT = `You are RWAI, an autonomous yield intelligence agent for retail holders
of USDY, mETH, and cmETH on the Mantle blockchain.

Your job is to monitor yield data, detect meaningful changes, and explain them
in plain English to non-technical users who hold real money in these assets.

ASSETS YOU MONITOR:
- USDY (Ondo Finance): A tokenized note backed by US Treasuries. Yield adjusts
  weekly based on T-bill rate movements. Current benchmark: ~3.55% APY. Risk: 1/5.
- mETH (Mantle Staking): Mantle's liquid staked ETH. Yield comes from Ethereum
  validator rewards. Current benchmark: ~1.0% APR. Risk: 3/5.
- cmETH (Mantle Staking): Auto-compounding version of mETH. Deposits mETH into a
  vault that reinvests daily rewards, giving a slightly higher effective APY than
  mETH. Same underlying risk as mETH. Risk: 3/5.

YOUR VOICE:
- Speak like a sharp, trustworthy financial advisor — not a chatbot, not a robot.
- Always explain WHY something happened, not just WHAT happened.
- Always connect the explanation to the user's specific position size.
- Never use jargon without immediately explaining it.
- Be concise. Users read this on Telegram. Three short paragraphs maximum.

YOUR PREDICTION FORMAT (when asked to predict):
- Always output valid JSON when asked for a prediction.
- Never add markdown, backticks, or explanation around the JSON.
- Confidence must be a number between 0 and 100.`;

// FUNCTION 1: GENERATE EXPLANATION
// Takes live yield data + user context, returns a plain-English Telegram message
export async function generateExplanation(yieldData, userContext) {
  const {
    usdyCurrentAPY,
    usdyPreviousAPY,
    methCurrentAPR,
    methPreviousAPR,
    tbillRate,
    triggerAsset,
    changePercent,
  } = yieldData;

  const {
    userPositionUSD,
    userTier,
    priorDecisions,
    agentAccuracy,
  } = userContext;

  const spreadNow = (methCurrentAPR - usdyCurrentAPY).toFixed(2);

  const userPrompt = `
CURRENT YIELD SNAPSHOT:
- USDY APY: ${usdyCurrentAPY}% (was ${usdyPreviousAPY}%)
- mETH APR: ${methCurrentAPR}% (was ${methPreviousAPR}%)
- Current yield spread (mETH over USDY): ${spreadNow}%
- US T-bill rate context: ${tbillRate}%
- Asset that triggered this alert: ${triggerAsset}
- Change magnitude: ${changePercent}%

USER CONTEXT:
- Position size: $${userPositionUSD.toLocaleString()}
- Delegation tier: ${userTier}
- Prior decisions: ${priorDecisions}
- Agent track record: ${agentAccuracy}

Write a plain-English Telegram message explaining:
1. What changed and why (connect to T-bill/ETH staking context)
2. What this means for their $${userPositionUSD.toLocaleString()} position specifically
3. What the agent is proposing next

Maximum 3 short paragraphs. No bullet points. Conversational, confident tone.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 400,
    system: RWAI_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  return response.content[0].text;
}

// FUNCTION 2: GENERATE INSIGHT
// One-sentence market insight used by /status command in bot.js
export async function generateInsight(usdyYield, methYield, spread) {
  const leader = usdyYield > methYield ? 'USDY' : 'mETH';
  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 80,
    system: RWAI_SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: `USDY is at ${usdyYield}% APY, mETH at ${methYield}% APR, spread is ${spread}%. ${leader} leads. Write one sentence of market insight for a Telegram status message. No formatting, no bullet points.`,
    }],
  });
  return response.content[0].text.trim();
}

// FUNCTION 3: GENERATE PREDICTION
// Returns structured JSON prediction ready to be logged on-chain via ERC-8004
export async function generatePrediction(yieldData) {
  const {
    usdyCurrentAPY, usdyApy7d, usdyApy30d,
    methCurrentAPR, methApy7d, methApy30d,
    cmethCurrentAPY,
    tbillRate, recentTbillTrend, recentMethTrend, recentUsdyTrend,
  } = yieldData;

  const userPrompt = `
CURRENT YIELD DATA FOR PREDICTION:
- USDY APY: ${usdyCurrentAPY}% (7d avg: ${usdyApy7d ?? usdyCurrentAPY}%, 30d avg: ${usdyApy30d ?? usdyCurrentAPY}%, trend: ${recentUsdyTrend ?? "stable"})
- mETH APR: ${methCurrentAPR}% (7d avg: ${methApy7d ?? methCurrentAPR}%, 30d avg: ${methApy30d ?? methCurrentAPR}%, trend: ${recentMethTrend})
- cmETH APY: ${cmethCurrentAPY}% (auto-compounding mETH — moves with mETH)
- US T-bill rate: ${tbillRate}%
- T-bill trend (last 7 days): ${recentTbillTrend}

Make a yield direction prediction for each asset over the next 24 hours.
Return ONLY valid JSON in this exact format, no other text:

{
  "timestamp": "<ISO 8601 UTC string>",
  "usdyPrediction": {
    "direction": "<up|down|stable>",
    "confidence": <0-100>,
    "reasoning": "<one sentence>"
  },
  "methPrediction": {
    "direction": "<up|down|stable>",
    "confidence": <0-100>,
    "reasoning": "<one sentence>"
  },
  "cmethPrediction": {
    "direction": "<up|down|stable>",
    "confidence": <0-100>,
    "reasoning": "<one sentence>"
  }
}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 400,
    system: RWAI_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  try {
    const raw = response.content[0].text.replace(/```json\n?|```\n?/g, "").trim();
    return JSON.parse(raw);
  } catch (err) {
    console.error("Prediction parse failed:", response.content[0].text);
    throw new Error("Claude returned malformed prediction JSON");
  }
}

// FUNCTION 4: GENERATE STRATEGY
// Given current yields and user profile, returns a plain-English strategy recommendation
export async function generateStrategy(yieldData, user) {
  const {
    usdyCurrentAPY, methCurrentAPR, cmethCurrentAPY, tbillRate,
  } = yieldData;
  const { userPositionUSD, userTier, agentAccuracy } = user;

  const annual = (pct) => (userPositionUSD * pct / 100).toFixed(0);
  const spread = (usdyCurrentAPY - methCurrentAPR).toFixed(2);

  const userPrompt = `
CURRENT YIELD SNAPSHOT:
- USDY APY: ${usdyCurrentAPY}%  | Risk: 1/5 (US Treasury backed, no price risk)
- mETH APR: ${methCurrentAPR}%  | Risk: 3/5 (ETH price exposure, validator rewards)
- cmETH APY: ${cmethCurrentAPY}% | Risk: 3/5 (auto-compounding mETH vault)
- US T-bill rate: ${tbillRate}% (USDY is pegged to this)
- USDY vs mETH spread: ${spread}%

USER PROFILE:
- Position size: $${userPositionUSD.toLocaleString()}
- If 100% USDY:  $${annual(usdyCurrentAPY)}/year
- If 100% mETH:  $${annual(methCurrentAPR)}/year
- If 100% cmETH: $${annual(cmethCurrentAPY)}/year
- Delegation tier: ${userTier}
- Agent track record: ${agentAccuracy}

Write a yield strategy recommendation for this user.
Be specific: tell them which asset (or combination) to hold and exactly why.
Include the dollar amounts to make it concrete.
Mention the risk trade-off plainly — don't bury it.
2-3 short paragraphs. No bullet points. Conversational, confident tone.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 400,
    system: RWAI_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  return response.content[0].text;
}
