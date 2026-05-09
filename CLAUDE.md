# RWAI — Claude Code Project Brief
> Paste this into Claude Code as your first message, or save as CLAUDE.md in the project root.

---

## What We're Building

**RWAI** (pronounced "ar-why") is an autonomous RWA yield intelligence agent built on Mantle Network for the Mantle Turing Test Hackathon 2026 (AI x RWA track, $100K prize pool, deadline June 15 2026).

RWAI monitors USDY (Ondo Finance, ~3.55% APY) and mETH (Mantle Staking, ~1.98% APR) yield spreads on Mantle, explains changes in plain English via Claude, proposes rebalancing actions via Telegram, and logs every decision on-chain via ERC-8004 on Mantle Mainnet — creating a verifiable AI track record judges can audit.

**The winning demo scene:** Agent detects yield shift → explains it in plain English via Telegram → user taps Approve → transaction visible on Mantle Explorer.

---

## Current Build Status (as of May 8, 2026)

### What's Working
- `src/promptEngine.js` — generateExplanation + generatePrediction + generateInsight via Claude API ✅
- `src/dataFetcher.js` — DeFiLlama live yield data (USDY + mETH), fetchYieldData + shouldAlert exported ✅
- `src/agent.js` — autonomous polling loop, writes `pendingAlert.json`, appends to `predictions.jsonl` ✅
- `src/bot.js` — Telegram bot with /start, /status, /compare, /explain, /history, /setup, approve/dismiss + logDecision() wired ✅
- `src/reputation.js` — ERC-8004 on-chain anchoring on Mantle Mainnet ✅
- `index.js` — single entry point starting both agent and bot ✅
- Three-tier delegation onboarding (`/setup` command, `data/userProfile.json`) ✅
- Prediction accuracy tracking — running accuracy % in `/history` ✅
- GitHub repo live (public, README with architecture diagram, contract address, tx hash) ✅
- `rwai.fyi` live on Vercel ✅
- Dashboard at `rwai.fyi/dashboard` — wallet connect, live DeFiLlama prices, agent insight, simulate rebalance, agent history, token logos, 24h price changes, yield earned counter ✅
- ToS and Privacy Policy pages ✅
- `contracts/RWAIVault.sol` — compiled with Hardhat + OpenZeppelin v5 ✅
- Latest confirmed Mantle Mainnet tx: `0xa041618da351ae12037d409c5981abd05aa708557337a798ab1a48426948b36a`

### In Progress
- `contracts/RWAIVault.sol` testnet deployment — in progress with dev Tokhi
- Logo — in progress with designer King Ade
- Demo video — not yet recorded (script ready, Step 7 below)
- DoraHacks BUIDL submission — form filled, not yet submitted (pending demo video link)

---

## The Stack
- **Runtime:** Node.js ESM (type: module)
- **AI:** Claude API via @anthropic-ai/sdk, model: claude-sonnet-4-5
- **Blockchain:** Ethers.js v6, Mantle Mainnet RPC
- **Bot:** Telegraf (in package.json ✅)
- **Data:** DeFiLlama public API (no auth needed)
- **On-chain:** ERC-8004 Reputation Registry at `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` on Mantle Mainnet
- **Domain:** rwai.fyi (live on Vercel ✅)

### Environment Variables (already in .env)
- `ANTHROPIC_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `MANTLE_RPC` — Mantle Mainnet RPC
- `MANTLE_PRIVATE_KEY` — funded wallet for on-chain calls
- `REPUTATION_REGISTRY_ADDRESS` — `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`

---

## User Model

Three delegation tiers set during onboarding:
- **Tier 1 — Watch Only:** alerts only, no execution
- **Tier 2 — Propose and Confirm:** agent proposes, user taps approve in Telegram
- **Tier 3 — Delegated:** auto-execute up to user-set cap (e.g. $500)

Current test user: `$4,200 USDY position, Tier 2, 73% agent accuracy over 24 predictions`

---

## The Full Autonomous Loop (target state)

```
node index.js
    ↓
agent.js polls every 30 minutes
    ↓ fetches USDY + mETH yield via DeFiLlama
    ↓ generates prediction → appends to data/predictions.jsonl
    ↓ compares to previous snapshot in data/lastYield.json
    ↓ if spread > 1.5% or yield moved > 0.1%:
        → generates plain-English explanation via Claude
        → writes data/pendingAlert.json { explanation, prediction, yieldData, sent: false }
    ↓
bot.js checks for pendingAlert.json every 2 minutes
    ↓ if found and sent: false:
        → sends Telegram message with approve/dismiss inline buttons
        → marks sent: true
    ↓
User taps Approve in Telegram
    ↓ bot reads pendingAlert.json
    ↓ calls logDecision() in reputation.js
    ↓ gets Mantle Explorer tx hash
    ↓ replies: "Decision logged on-chain ✅ [view on explorer]"
    ↓ marks approved: true in pendingAlert.json
```

---

## Build Sequence — Status

### STEP 1 — Fix the 6 broken wires ✅ DONE
All 6 wires fixed: fetchYieldData + shouldAlert exported, generateInsight in promptEngine.js, pendingAlert.json + predictions.jsonl wired in agent.js, logDecision() wired in bot.js approve action, index.js created, telegraf in package.json.

### STEP 2 — Three-tier delegation onboarding ✅ DONE
`/setup` command live in bot.js. Tier stored in `data/userProfile.json`. Agent reads tier before deciding whether to write pendingAlert or auto-execute.

### STEP 3 — Prediction accuracy tracking ✅ DONE
Running accuracy % surfaced in `/history`. Predictions appended to `data/predictions.jsonl` with correct/incorrect resolution after 24h window.

### STEP 4 — GitHub repo + README ✅ DONE
Public repo live. README includes one-line pitch, rwai.fyi link, contract address, latest tx hash, ASCII architecture diagram, setup instructions, track info.

### STEP 5 — Deploy rwai.fyi ✅ DONE
Landing page live on Vercel. Hero, live yield ticker (DeFiLlama), Telegram link, "How it works", contract + explorer link all present.
Dashboard live at rwai.fyi/dashboard — wallet connect, live prices, agent insight, simulate rebalance, agent history, token logos, 24h changes, yield earned counter.

### STEP 6 — DoraHacks BUIDL submission 🔄 IN PROGRESS
Form filled with project description, GitHub link, rwai.fyi, contract address, track. **Blocked on demo video link — submit immediately after Step 7.**

### STEP 7 — 2-minute demo video ⏳ TODO (next)
Script:
1. Open Telegram, show the bot running
2. Type /status — show live yield data + Mantle Explorer link
3. Type /compare — show USDY vs mETH spread
4. Trigger an alert manually (temporarily lower the threshold) — show the approve/dismiss buttons
5. Tap Approve — show the Mantle Explorer transaction confirming
6. Show rwai.fyi/dashboard — wallet connect, live prices, agent insight
7. Close with: "RWAI — autonomous, verifiable, plain English. Built on Mantle."

Record with Loom or QuickTime. Upload to YouTube (unlisted is fine). Then immediately submit DoraHacks.

### STEP 7b — RWAIVault testnet deployment 🔄 IN PROGRESS (with Tokhi)
`contracts/RWAIVault.sol` compiled. Tokhi handling testnet deploy. Once live: add deployed address to README + DoraHacks submission.

### STEP 8 — X (Twitter) campaign for Community Voting
Community Voting is worth $8,500 and decided by votes on DoraHacks. Start this in parallel with Step 7.

Post cadence:
- Post 1: "Day 1 — built the Claude explanation engine. This is what RWAI sends your Telegram when USDY yield drops." [screenshot]
- Post 2: "Day 3 — agent is live on Mantle Mainnet. Every prediction logged on-chain." [explorer link]
- Post 3: "Day 5 — full loop working. Fetch → Explain → Propose → Approve → On-chain. One tap." [screen recording]
- Post 4: "rwai.fyi is live. Try the bot." [link]
- Post 5: "Voting is open. If you think RWA holders deserve a plain-English co-pilot, vote for RWAI." [DoraHacks link]

Tag: @0xMantle @ondofinance in every post

---

## Hackathon Judging Criteria (memorise this)

**Grand Champion** (Technical Depth 30%, Innovation 25%, Mantle Ecosystem 25%, Product Completeness 20%)

**AI x RWA Track** — General 60% (AI+RWA depth, technical completeness, Mantle integration, compliance awareness) + Track-specific 40% (real-world validity: clear asset, defined target users, complete UX)

**Submission question to answer:** "What type of real-world asset are you bringing on-chain? How does AI play a role? How is it realized on Mantle?"

**Answer:** USDY (tokenized US Treasuries by Ondo Finance) and mETH (Mantle liquid staked ETH). AI monitors yield spreads, generates plain-English explanations, makes verifiable on-chain predictions via ERC-8004, and proposes rebalancing to retail holders who would otherwise have no visibility into yield dynamics. Realized on Mantle via the ERC-8004 Reputation Registry, Mantle RPC for data, and Merchant Moe for swap execution.

**Best UI/UX scoring:** Visual Design 30%, Interaction & Flow 30%, AI Interaction Design 25%, Accessibility 15%

**Community Voting:** Most votes on DoraHacks wins $8,500

**20 Project Deployment Award:** $1,000 — currently 0 BUIDLs submitted out of 315 registered hackers. You qualify once rwai.fyi is live and the GitHub README is complete.

---

## Key Context for Judges

- Retail mETH holders think they're earning 5.9% APY. They're actually earning ~1.98%. RWAI would have told them the day it changed.
- USDY vs mETH spread is currently 1.56% — wide enough to trigger a rebalancing proposal
- The ERC-8004 track record starts accumulating from Day 1 of deployment — judges can audit prediction accuracy on Mantle Explorer
- No other submission will have a verifiable AI prediction track record. Every other agent is new on submission day. RWAI arrives at demo day with history.

---

## What NOT to Do
- Don't add features before the demo video and DoraHacks submission are done — that's the current blocker
- Don't build Tier 3 auto-execution for the hackathon — too risky, Tier 2 is enough
- Don't scope-creep into xStocks or other RWA assets before submission — USDY + mETH is the MVP
- Don't use `sudo npm install` — it causes permission errors
- Don't commit `.env` to GitHub — it's in .gitignore already

---

*Last updated: May 8, 2026 | Built by Ayman (@0xSunSeeker) | rwai.fyi*
