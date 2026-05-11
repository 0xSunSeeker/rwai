// src/promptEngine.js
// The brain of RWAI — takes yield data in, returns plain-English explanation
// and a structured prediction object ready for on-chain logging

import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
dotenv.config();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const RWAI_SYSTEM_PROMPT = `You are RWAI, an autonomous yield intelligence agent for retail holders
of USDY, mETH, and cmETH on the Mantle blockchain.

Your job is to monitor yield data, detect meaningful changes, and explain them
in plain English to non-technical users who hold real money in these assets.

ASSETS YOU MONITOR:
- USDY (Ondo Finance): A tokenized note backed by US Treasuries. Yield adjusts
  weekly based on T-bill rate movements. Risk: 1/5. No ETH price exposure.
- mETH (Mantle Staking): Mantle's liquid staked ETH. Yield comes from Ethereum
  validator rewards. Risk: 3/5. Exposed to ETH price movements.
- cmETH (Mantle Staking): Auto-compounding version of mETH. Reinvests validator
  rewards daily for a slightly higher effective APY. Same risk as mETH: 3/5.

CRITICAL RULES — NEVER VIOLATE THESE:
- Only reference data that is explicitly provided to you in the user message.
- Never invent trends, market conditions, or external context not in the data.
- Never claim T-bill rates moved unless tbillRate data shows a change.
- Never claim ETH staking demand changed unless methTrend data shows it.
- If a data field is missing or null, say you don't have enough data — do not guess.
- Confidence scores must reflect actual data quality: if trend data is unavailable,
  cap confidence at 60. If only current rates are available, cap at 55.
- Never recommend mETH over USDY unless mETH APR is numerically higher than USDY APY.

YOUR VOICE:
- Speak like a sharp, trustworthy financial advisor — not a chatbot, not a robot.
- Always explain WHY something happened using only the data provided.
- Always connect the explanation to the user's specific position size.
- Never use jargon without immediately explaining it.
- Be concise. Users read this on Telegram. Three short paragraphs maximum.`;


// FUNCTION 1: GENERATE EXPLANATION
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

  // USDY leads mETH currently — spread is USDY minus mETH
  const spreadNow = (usdyCurrentAPY - methCurrentAPR).toFixed(2);
  const leader = usdyCurrentAPY >= methCurrentAPR ? 'USDY' : 'mETH';
  const usdyChanged = usdyCurrentAPY !== usdyPreviousAPY;
  const methChanged = methCurrentAPR !== methPreviousAPR;

  const userPrompt = `
CURRENT YIELD SNAPSHOT:
- USDY APY: ${usdyCurrentAPY}% (previously ${usdyPreviousAPY}%) ${usdyChanged ? `— changed by ${(usdyCurrentAPY - usdyPreviousAPY).toFixed(2)}%` : '— unchanged'}
- mETH APR: ${methCurrentAPR}% (previously ${methPreviousAPR}%) ${methChanged ? `— changed by ${(methCurrentAPR - methPreviousAPR).toFixed(2)}%` : '— unchanged'}
- Yield spread (USDY minus mETH): ${spreadNow}% — ${leader} is the higher yielding asset
- US T-bill rate: ${tbillRate}%
- Asset that triggered this alert: ${triggerAsset}
- Change magnitude: ${changePercent}%

USER CONTEXT:
- Position size: $${userPositionUSD.toLocaleString()}
- Delegation tier: ${userTier}
- Prior decisions: ${priorDecisions}
- Agent track record: ${agentAccuracy}

SPREAD ANALYSIS:
- Current USDY vs mETH spread: ${yieldData.currentSpread != null ? yieldData.currentSpread.toFixed(2) : 'N/A'}%
- Alert type: ${yieldData.alertType ?? 'yield_change'}
- Rebalance proposal triggered: ${yieldData.spreadAboveProposal ? 'YES — spread exceeds proposal threshold' : 'NO — spread below proposal threshold'}
${yieldData.spreadAboveProposal ? `
IMPORTANT: The spread between USDY and mETH is above the rebalance proposal threshold.
You MUST include a specific rebalance proposal in your message:
- Suggest moving a portion of mETH into USDY (not all — propose 25-50% of mETH position)
- State the exact dollar amount to move based on userPositionUSD
- Explain why holding more USDY makes sense given the current spread
- End with: "I am preparing a one-tap approval for this rebalance."
` : ''}
Write a plain-English Telegram message explaining:
1. What changed (only reference the data above — do not invent context)
2. What this means for their $${userPositionUSD.toLocaleString()} position
3. What the agent recommends next based purely on the yield numbers

Maximum 3 short paragraphs. No bullet points. Conversational, confident tone.
Do not mention T-bill movements, ETH staking demand, or validator trends
unless the data above shows an actual change in those figures.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 400,
    system: RWAI_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  return response.content[0].text;
}


// FUNCTION 2: GENERATE INSIGHT
export async function generateInsight(usdyYield, methYield, spread) {
  const leader = usdyYield >= methYield ? 'USDY' : 'mETH';
  const spreadAbs = Math.abs(spread).toFixed(2);

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 80,
    system: RWAI_SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: `USDY is at ${usdyYield}% APY. mETH is at ${methYield}% APR. ${leader} leads by ${spreadAbs}%. Write one sentence of market insight for a Telegram status message based only on these numbers. No formatting, no bullet points, no invented context.`,
    }],
  });
  return response.content[0].text.trim();
}


// FUNCTION 3: GENERATE PREDICTION
export async function generatePrediction(yieldData) {
  const {
    usdyCurrentAPY, usdyApy7d, usdyApy30d, recentUsdyTrend,
    methCurrentAPR, methApy7d, methApy30d, recentMethTrend,
    cmethCurrentAPY,
    tbillRate, recentTbillTrend,
  } = yieldData;

  // Determine data quality to set honest confidence ceiling
  const hasHistoricalData = usdyApy7d && usdyApy30d && methApy7d && methApy30d;
  const hasTrendData = recentUsdyTrend && recentMethTrend && recentTbillTrend;
  const confidenceCeiling = hasHistoricalData && hasTrendData ? 85 : hasTrendData ? 70 : 55;

  const userPrompt = `
CURRENT YIELD DATA:
- USDY APY: ${usdyCurrentAPY}%
  7-day avg: ${usdyApy7d ?? 'not available'}%
  30-day avg: ${usdyApy30d ?? 'not available'}%
  Recent trend: ${recentUsdyTrend ?? 'not available'}
- mETH APR: ${methCurrentAPR}%
  7-day avg: ${methApy7d ?? 'not available'}%
  30-day avg: ${methApy30d ?? 'not available'}%
  Recent trend: ${recentMethTrend ?? 'not available'}
- US T-bill rate: ${tbillRate}%
  T-bill trend (7 days): ${recentTbillTrend ?? 'not available'}

DATA QUALITY NOTE:
Maximum confidence you may assign to any prediction: ${confidenceCeiling}
If trend data is marked "not available", you must use a confidence of 50 or lower.
Base your reasoning ONLY on the numbers provided. Do not reference news,
Fed decisions, or market events not present in the data above.

Make a yield direction prediction for each asset over the next 24 hours.
Return ONLY valid JSON, no other text:

{
  "timestamp": "<ISO 8601 UTC string>",
  "usdyPrediction": {
    "direction": "<up|down|stable>",
    "confidence": <0-${confidenceCeiling}>,
    "reasoning": "<one sentence using only the data provided>"
  },
  "methPrediction": {
    "direction": "<up|down|stable>",
    "confidence": <0-${confidenceCeiling}>,
    "reasoning": "<one sentence using only the data provided>"
  },
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
export async function generateStrategy(yieldData, user) {
  const {
    usdyCurrentAPY, methCurrentAPR, cmethCurrentAPY, tbillRate,
  } = yieldData;
  const { userPositionUSD, userTier, agentAccuracy } = user;

  const annual = (pct) => (userPositionUSD * pct / 100).toFixed(0);
  const spread = (usdyCurrentAPY - methCurrentAPR).toFixed(2);
  const usdyLeads = usdyCurrentAPY >= methCurrentAPR;

  const userPrompt = `
CURRENT YIELD SNAPSHOT:
- USDY APY: ${usdyCurrentAPY}% | Annual on full position: $${annual(usdyCurrentAPY)}/yr | Risk: 1/5
- mETH APR: ${methCurrentAPR}% | Annual on full position: $${annual(methCurrentAPR)}/yr | Risk: 3/5
- cmETH APY: ${cmethCurrentAPY}% | Annual on full position: $${annual(cmethCurrentAPY)}/yr | Risk: 3/5
- US T-bill rate: ${tbillRate}% (USDY yield is derived from this)
- USDY vs mETH spread: ${spread}% — ${usdyLeads ? 'USDY leads' : 'mETH leads'}

USER PROFILE:
- Position size: $${userPositionUSD.toLocaleString()}
- Delegation tier: ${userTier}
- Agent track record: ${agentAccuracy}

STRATEGY RULES (follow these strictly):
- If USDY APY is higher than mETH APR, recommend holding USDY. Do not suggest moving to mETH.
- If mETH APR is higher than USDY APY, explain the yield benefit but also explain the added ETH price risk.
- Always mention the risk difference between USDY (Treasury-backed, no price risk) and mETH (ETH price exposure).
- Give specific dollar amounts. Make the annual yield difference concrete.
- Do not recommend any action not supported by the yield numbers above.

Write a 2-3 paragraph strategy recommendation. No bullet points. Conversational, confident tone.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 400,
    system: RWAI_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  return response.content[0].text;
}
