# RWAI — Claude Code Project Brief
> Paste this into Claude Code as your first message, or save as CLAUDE.md in the project root.

---

## What We're Building

**RWAI** (pronounced "ar-why") is an autonomous RWA yield intelligence agent built on Mantle Network for the Mantle Turing Test Hackathon 2026 (AI x RWA track, $100K prize pool, deadline June 15 2026).

RWAI monitors USDY (Ondo Finance, ~3.55% APY) and mETH (Mantle Staking, ~1.98% APR) yield spreads on Mantle, explains changes in plain English via Claude, proposes rebalancing actions via Telegram, and logs every decision on-chain via ERC-8004 on Mantle Mainnet — creating a verifiable AI track record judges can audit.

**The winning demo scene:** Agent detects yield shift → explains it in plain English via Telegram → user taps Approve → transaction visible on Mantle Explorer.

---

## Current Build Status (as of May 6, 2026)

### What's Working
- `src/promptEngine.js` — generateExplanation + generatePrediction via Claude API ✅
- `src/dataFetcher.js` — DeFiLlama live yield data (USDY + mETH) ✅
- `src/agent.js` — autonomous polling loop with generateInsight ✅
- `src/bot.js` — Telegram bot with /start, /status, /compare, /explain, /history, approve/dismiss ✅
- `src/reputation.js` — ERC-8004 on-chain anchoring on Mantle Mainnet ✅
- Latest confirmed Mantle Mainnet tx: `0xa041618da351ae12037d409c5981abd05aa708557337a798ab1a48426948b36c`

### What's Broken (Fix These First — 6 Wires)
1. `bot.js` imports `generateInsight` from `./agent.js` — function doesn't exist there, should come from `./promptEngine.js`
2. `bot.js` imports `fetchYieldData` and `shouldAlert` from `./dataFetcher.js` — neither exported
3. `agent.js` never writes `pendingAlert.json` — the core connection between agent and bot is missing
4. `agent.js` never appends to `predictions.jsonl` — /history command always empty
5. `approve` action in bot.js never calls `logDecision()` — on-chain reputation logging skipped
6. No single entry point — must run two terminals manually

---

## The Stack
- **Runtime:** Node.js ESM (type: module)
- **AI:** Claude API via @anthropic-ai/sdk, model: claude-sonnet-4-5
- **Blockchain:** Ethers.js v6, Mantle Mainnet RPC
- **Bot:** Telegraf (installed in node_modules, missing from package.json)
- **Data:** DeFiLlama public API (no auth needed)
- **On-chain:** ERC-8004 Reputation Registry at `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` on Mantle Mainnet
- **Domain:** rwai.fyi (purchased, not yet live)

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

## Build Sequence — Do These In Order

### STEP 1 — Fix the 6 broken wires (do this now)
Follow the plan already generated:
1. Add `fetchYieldData` and `shouldAlert` exports to `dataFetcher.js`
2. Add `generateInsight` to `promptEngine.js`, fix bot.js import
3. Wire `agent.js` to write `pendingAlert.json` and append to `predictions.jsonl`
4. Wire `approve` action in `bot.js` to call `logDecision()` and reply with explorer link
5. Create `index.js` as single entry point that starts both agent and bot
6. Add telegraf to package.json dependencies

**Test:** `node index.js` → both agent and bot start → open Telegram → /status returns live yield data with Mantle Explorer link

### STEP 2 — Three-tier delegation onboarding
Add `/setup` command to bot.js that asks user their delegation tier preference:
- Watch Only (alerts only)
- Propose and Confirm (one-tap approval)  
- Delegated (auto-execute up to $X)

Store preference in `data/userProfile.json`. Agent reads tier before deciding whether to write pendingAlert or auto-execute.

**Test:** send `/setup` in Telegram → choose tier → send `/status` → response reflects chosen tier

### STEP 3 — Prediction accuracy tracking
After each prediction, when the 24-hour window closes, agent should:
- Read the prediction from `predictions.jsonl`
- Compare predicted direction to actual yield movement
- Append `{ correct: true/false, actualDirection }` to that prediction entry
- Calculate running accuracy percentage

Surface this in bot.js `/history` command as: "Agent accuracy: X% over Y predictions"

**Test:** `/history` in Telegram shows prediction log with accuracy score

### STEP 4 — GitHub repo + README
Create a public GitHub repository:
- Repo name: `rwai`
- README.md must include:
  - One-line pitch
  - Live demo URL: rwai.fyi
  - Deployed contract address on Mantle
  - Latest transaction hash
  - Architecture diagram (ASCII is fine)
  - Setup instructions
  - Track: AI x RWA — Mantle Turing Test Hackathon 2026

**Test:** README renders correctly on GitHub, all links work

### STEP 5 — Deploy rwai.fyi
Create a minimal but polished landing page:
- Hero: "RWAI — Your autonomous RWA yield agent on Mantle"
- Live yield ticker: USDY vs mETH current APY (fetched from DeFiLlama on load)
- One-tap Telegram bot link
- "How it works" — the 4-layer loop in plain English
- Deployed contract address + Mantle Explorer link

Deploy to Vercel connected to the GitHub repo. Point rwai.fyi DNS to Vercel.

**Test:** rwai.fyi loads, shows live yield data, Telegram link works

### STEP 6 — DoraHacks BUIDL submission
Update the BUIDL page at dorahacks.io/hackathon/mantleturingtesthackathon2026 with:
- Project description (use the one-line pitch + 3 bullet points)
- GitHub repo link
- Live demo: rwai.fyi
- Contract address: `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`
- Track: AI x RWA
- Demo video link (YouTube)

### STEP 7 — 2-minute demo video
Script:
1. Open Telegram, show the bot running
2. Type /status — show live yield data + Mantle Explorer link
3. Type /compare — show USDY vs mETH spread
4. Trigger an alert manually (temporarily lower the threshold) — show the approve/dismiss buttons
5. Tap Approve — show the Mantle Explorer transaction confirming
6. Close with: "RWAI — autonomous, verifiable, plain English. Built on Mantle."

Record with Loom or QuickTime. Upload to YouTube (unlisted is fine).

### STEP 8 — X (Twitter) campaign for Community Voting
Community Voting is worth $8,500 and decided by votes on DoraHacks. Start this in parallel with Step 5.

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
- Don't add features before Step 1 is done — the broken wires kill the demo
- Don't build Tier 3 auto-execution for the hackathon — too risky, Tier 2 is enough
- Don't scope-creep into xStocks or other RWA assets before submission — USDY + mETH is the MVP
- Don't use `sudo npm install` — it causes permission errors
- Don't commit `.env` to GitHub — it's in .gitignore already

---

*Last updated: May 6, 2026 | Built by Ayman (@0xSunSeeker) | rwai.fyi*
