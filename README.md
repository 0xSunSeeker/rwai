# RWAI — Autonomous RWA Yield Intelligence Agent

> Your plain-English co-pilot for USDY and mETH on Mantle. Detects yield shifts, explains them in plain English, proposes rebalances via Telegram, and logs every decision on-chain.

**Track:** AI × RWA — [Mantle Turing Test Hackathon 2026](https://dorahacks.io/hackathon/mantleturingtesthackathon2026)  
**Live demo:** [rwai.fyi](https://rwai.fyi)  
**Telegram bot:** [@rwaiapp_bot](https://t.me/rwaiapp_bot)  
**GitHub:** [github.com/0xSunSeeker/rwai](https://github.com/0xSunSeeker/rwai)

---

## What it does

Retail holders of USDY and mETH have no visibility into yield dynamics. RWAI fixes that:

1. **Fetches** live yield data for USDY (Ondo Finance) and mETH (Mantle Staking) every 30 minutes via DeFiLlama
2. **Detects** meaningful shifts (>0.1% yield change or >1.5% spread)
3. **Explains** what happened and why in plain English via Claude Sonnet
4. **Proposes** a rebalancing action — you approve with one tap in Telegram
5. **Logs** every decision on-chain via ERC-8004, building a verifiable AI track record judges can audit from Day 1

No other submission arrives at demo day with a prediction history. RWAI does.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        node index.js                        │
└──────────────────────┬──────────────────────────────────────┘
                       │ starts both
          ┌────────────┴────────────┐
          ▼                         ▼
  ┌───────────────┐        ┌────────────────┐
  │   agent.js    │        │    bot.js      │
  │  every 30min  │        │  Telegram bot  │
  └───────┬───────┘        └───────┬────────┘
          │                        │
          │ 1. fetch yields        │ 5. poll pendingAlert.json
          ▼                        │    every 2 minutes
  ┌───────────────┐                │
  │ DeFiLlama API │                │ 6. send alert + buttons
  │  USDY + mETH  │                ▼
  └───────┬───────┘       ┌────────────────┐
          │                │  User taps     │
          │ 2. generate     │  ✅ Approve    │
          │    prediction   └───────┬────────┘
          ▼                        │
  ┌───────────────┐                │ 7. logDecision()
  │  Claude API   │                ▼
  │  Sonnet 4.5   │       ┌────────────────┐
  └───────┬───────┘       │ reputation.js  │
          │                │ ERC-8004       │
          │ 3. write        │ Mantle Mainnet │
          ▼                └───────┬────────┘
  data/predictions.jsonl           │
  data/pendingAlert.json           │ 8. explorer URL
          │                        ▼
          └──────────────► Telegram reply
                           "Decision logged ✅
                            [View on Explorer]"
```

---

## Deployed contract

| | |
|---|---|
| **Registry** | ERC-8004 Reputation Registry |
| **Address** | [`0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`](https://explorer.mantle.xyz/address/0x8004BAa17C55a88189AE136b182e5fdA19dE9b63) |
| **Network** | Mantle Mainnet (chainId 5000) |
| **Latest tx** | [`0xb24c9762becc831a9855a2a73b657f841f42a59f8858f2822ea9e7aee50080ec`](https://explorer.mantle.xyz/tx/0xb24c9762becc831a9855a2a73b657f841f42a59f8858f2822ea9e7aee50080ec) |

---

## Assets monitored

| Asset | Protocol | Type | Current yield |
|---|---|---|---|
| **USDY** | Ondo Finance | Tokenized US Treasuries | ~3.55% APY |
| **mETH** | Mantle Staking | Liquid staked ETH | ~1.0% APR |

**Current spread: ~2.56%** — wide enough that RWAI has already proposed a rebalance.

---

## Delegation tiers

| Tier | Behaviour |
|---|---|
| **1 — Watch Only** | Alerts only. Nothing executes. |
| **2 — Propose and Confirm** | Agent proposes, you approve with one tap. |
| **3 — Delegated** | Auto-execute up to a cap *(coming soon)* |

Set your tier with `/setup` in Telegram.

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js ESM |
| AI | Claude Sonnet 4.5 via Anthropic SDK |
| Blockchain | Ethers.js v6, Mantle Mainnet RPC |
| Bot | Telegraf |
| Data | DeFiLlama public API |
| On-chain | ERC-8004 Reputation Registry |

---

## Setup

```bash
git clone https://github.com/0xSunSeeker/rwai
cd rwai
npm install
```

Copy `.env.example` and fill in your keys:

```bash
cp .env.example .env
```

```
ANTHROPIC_API_KEY=
TELEGRAM_BOT_TOKEN=      # from @BotFather
MANTLE_RPC=https://rpc.mantle.xyz
MANTLE_PRIVATE_KEY=      # funded wallet for on-chain calls
REPUTATION_REGISTRY_ADDRESS=0x8004BAa17C55a88189AE136b182e5fdA19dE9b63
FRED_API_KEY=            # optional — T-bill rate context
```

```bash
node index.js
```

Open Telegram, find [@rwaiapp_bot](https://t.me/rwaiapp_bot), send `/start`.

---

## Submission

**Hackathon:** Mantle Turing Test Hackathon 2026  
**Track:** AI × RWA  
**Builder:** Ayman Zahran ([@0xSunSeeker](https://x.com/0xSunSeeker))  

**What type of real-world asset are you bringing on-chain?**  
USDY (tokenized US Treasuries by Ondo Finance) and mETH (Mantle liquid staked ETH). AI monitors yield spreads, generates plain-English explanations, makes verifiable on-chain predictions via ERC-8004, and proposes rebalancing to retail holders who would otherwise have no visibility into yield dynamics. Realized on Mantle via the ERC-8004 Reputation Registry and Mantle RPC.
