# RWAI Contracts

Execution layer for the RWAI agent. `RWAIVault` accepts USDY or mETH from a user, swaps to the other token via Merchant Moe on Mantle, and returns the output directly to the user's wallet. Every swap is logged on-chain via the ERC-8004 Reputation Registry.

## Deployed Addresses (Mainnet)

| Contract | Address |
|---|---|
| RWAIVault | _deploy and fill in_ |
| MoeRouter | `0xeaEE7EE68874218c3558b40063c42B82D3E7232a` |
| ERC-8004 Registry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |

## Prerequisites

- Node.js 18+
- `MANTLE_PRIVATE_KEY` in the root `.env` (the same `.env` used by the agent)
- Wallet funded with MNT for gas

Optional for explorer verification:
- `MANTLESCAN_API_KEY` in `.env`

Optional to set a specific agent wallet:
- `AGENT_ADDRESS` in `.env` (defaults to the deployer address if not set)

## Install

```bash
cd contracts
npm install
```

## Compile

```bash
npx hardhat compile
```

## Deploy to Mantle Sepolia (testnet)

```bash
npx hardhat run scripts/deploy.js --network mantleSepolia
```

Testnet faucet: https://faucet.sepolia.mantle.xyz

## Deploy to Mantle Mainnet

```bash
npx hardhat run scripts/deploy.js --network mantle
```

## Verify on Explorer

Copy the verify command printed by the deploy script, e.g.:

```bash
npx hardhat verify --network mantleSepolia <VAULT_ADDRESS> \
  "0xeaEE7EE68874218c3558b40063c42B82D3E7232a" \
  "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63" \
  "<AGENT_ADDRESS>"
```

---

## Mainnet Deploy Checklist (run through before deploying to mainnet)

- [ ] Confirm USDY decimals on Mantle — if 6, update `DEFAULT_CAP` in `RWAIVault.sol` from `500e18` to `500e6`
- [ ] Confirm USDY/mETH pair exists on Merchant Moe Classic (MoePair factory)
- [ ] Test full swap flow on Sepolia testnet end-to-end
- [ ] Set `AGENT_ADDRESS` in `.env` to the production agent wallet (not the deployer)
- [ ] Confirm deployer wallet has enough MNT for gas (~0.05 MNT estimated)
- [ ] After deploy, add `VAULT_ADDRESS` to `.env` and wire into `src/bot.js` approve action
- [ ] Call `getSupportedTokens()` on the deployed contract to confirm USDY, mETH, cmETH are registered
- [ ] Do a test swap on mainnet with a tiny amount (e.g. 1 USDY) before setting the full agent live

---

## Architecture

```
User wallet
  │
  │  (1) approve(vault, amountIn)   — user signs once per token
  │
  ▼
RWAIVault.executeSwap(user, tokenIn, tokenOut, amountIn, minOut, reasonHash)
  │  called by agentAddress only
  │
  ├─ require: not paused, both tokens supported, amountIn ≤ cap
  ├─ safeTransferFrom(user → vault, amountIn)
  ├─ forceApprove(router, amountIn)
  ├─ MoeRouter.swapExactTokensForTokens([tokenIn→tokenOut], to=user)
  │     output lands directly in user wallet
  ├─ forceApprove(router, 0)        — clear residual allowance
  ├─ emit SwapExecuted(...)
  └─ reputationRegistry.giveFeedback(...)   — non-reverting
```

## Key Security Properties

| Property | How it's enforced |
|---|---|
| Only agent can swap | `onlyAgent` modifier on `executeSwap` |
| Emergency stop | `whenNotPaused` + `pause()` / `unpause()` (owner only) |
| No re-entrancy | `nonReentrant` on `executeSwap` |
| User cap | `amountIn ≤ userCaps[user]` (default $500) |
| Slippage | `minAmountOut` passed to router — router reverts if not met |
| No fund custody | Output sent directly to `user` address via router's `to` param |
| No lingering approvals | Router allowance reset to 0 after each swap |
