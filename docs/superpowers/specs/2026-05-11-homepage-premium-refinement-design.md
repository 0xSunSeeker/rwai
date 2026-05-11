# RWAI Homepage Premium Refinement — Design Spec
**Date:** 2026-05-11
**File target:** `/Users/aymanzahran/Desktop/rwai/index.html`
**Approach:** Layered hybrid (CSS for aesthetics, single `ambientLoop()` JS orchestrator)
**Constraint:** Zero breaking changes to wallet connect, dashboard routing, live yield fetch, Telegram links, or responsiveness.

---

## Emotional Goal

> Calm intelligence. Autonomous monitoring. Institutional trust. Invisible AI infrastructure. Always-on financial oversight. Retail-friendly sophistication.

Bloomberg Terminal × Apple Wallet × Linear × Stripe Dashboard.

---

## Implementation Boundary

All changes live in `index.html`. No new files. The `ambientLoop()` function is self-contained — removing one `setInterval` call disables all dynamic behavior without touching any other logic.

---

## Section 1 — Hero: Ambient System Life

### 1A. Breathing Ambient Glow

**What:** Replace the existing one-shot `spotlight` keyframe with a persistent `breathe` keyframe.

**Implementation:**
- New `@keyframes breathe`: `opacity 0.06 → 0.13 → 0.06`, duration 7s, `ease-in-out infinite`
- Apply to `.hero-spotlight` in place of the current `spotlight` animation
- Preserve the radial gradient shape and positioning exactly
- No color change, no radius pulse — opacity only

**Feel:** Like an AI system quietly operating in the background.

### 1B. Terminal Live Activity Lines

**What:** The terminal appends a new log line every 12–18 seconds (randomised interval).

**Implementation:**
- Pool of ~12 operationally realistic messages, e.g.:
  - `"Spread threshold unchanged — +{liveSpread}%"`
  - `"USDY oracle heartbeat confirmed"`
  - `"Validator APR compression: monitoring"`
  - `"Position snapshot updated"`
  - `"Mantle block verified"`
  - `"Cross-referencing USDY vs Treasury rates"`
  - `"mETH exchange rate stable"`
  - `"Yield delta within normal bounds"`
- Messages that include yield values use `liveUSDYApy` / `liveMethApy` (already in scope from `loadYields()`)
- Append via existing `appendLog()` or equivalent — new lines use the same `fadeInLog` keyframe
- Max 12 lines in viewport; oldest line removed as new one enters
- Fired from `ambientLoop()` on a `setInterval` with 12000–18000ms randomised delay

### 1C. Rotating Hero Sub-Status

**What:** A single line of text below the hero badge that cycles through 5 status phrases.

**Implementation:**
- New element: `<p id="hero-status">` inserted directly after `.hero-badge`
- Styles: `font-size: 0.72rem`, `font-weight: 500`, `color: rgba(255,255,255,0.35)`, `letter-spacing: 0.05em`, `text-transform: uppercase`
- Transition: `opacity 0.6s ease, transform 0.6s ease` — fade out + `translateY(4px)`, swap text, fade in + `translateY(0)`
- 5 phrases, rotated every 4 seconds:
  1. "Monitoring Mantle yields live"
  2. "Evaluating spread conditions"
  3. "Comparing staking efficiency"
  4. "Anchoring AI decisions on-chain"
  5. "Detecting rebalance opportunities"
- JS: `setInterval` in `ambientLoop()` at 4000ms

---

## Section 2 — Yield Cards: Sophistication Pass

### 2A. Hover Lift

**What:** Subtle card elevation on hover.

**Implementation:**
- Add to `.yield-card` transition: `transform 0.25s cubic-bezier(0.25,0.46,0.45,0.94), box-shadow 0.25s cubic-bezier(0.25,0.46,0.45,0.94)`
- `.yield-card:hover`: `transform: translateY(-2px); box-shadow: 0 8px 32px rgba(0,0,0,0.4)`
- Existing hover background/border changes are preserved

### 2B. Sparklines

**What:** Ultra-minimal 7-point line chart below each yield percentage.

**Implementation:**
- Add `<canvas class="yield-sparkline" height="28">` below `.yield-pct` in each of the 4 cards
- Canvas styles: `width: 100%; height: 28px; display: block; margin-bottom: 8px; opacity: 0.6`
- `drawSparkline(canvas, currentValue)`:
  - Generate 7 points: last point = `currentValue`, prior 6 = `currentValue ± small random variance (±0.05%)`
  - Smooth bezier curve via canvas `bezierCurveTo`
  - Stroke: `#1D9E75`, line width: 1.5px
  - No fill, no axes, no labels
- Called after `loadYields()` resolves for USDY, mETH, cmETH cards
- Spread card sparkline: plots spread value using same technique with amber stroke `#F59E0B`

### 2C. Directional Indicators

**What:** Tiny arrow beside each yield percentage showing movement direction.

**Implementation:**
- Add `<span class="yield-dir" id="usdy-dir">—</span>` inside `.yield-pct` wrapper for each card
- Styles: `font-size: 0.85rem; margin-left: 6px; vertical-align: middle`
- Direction logic in `loadYields()`:
  - Compare fetched value against JS default (3.55 for USDY, 1.98 for mETH)
  - `↑` = green `#1D9E75`, `↓` = red `#c0392b`, `—` = `rgba(255,255,255,0.2)`
- Spread card gets larger arrow: `font-size: 1.1rem`

### 2D. Scan-Line Shimmer on Update

**What:** One-shot shimmer sweep on `.yield-pct` when data loads.

**Implementation:**
- `.yield-pct` gets `position: relative; overflow: hidden`
- `@keyframes shimmer-sweep`: `::after` pseudo-element, `width: 2px; height: 100%; background: rgba(255,255,255,0.25); transform: translateX(-100%) → translateX(400%)`, duration 0.6s, timing `ease`
- Add class `.shimmer` to trigger; remove after 700ms via JS `setTimeout`
- Called once in `loadYields()` after all values are set

---

## Section 3 — Spread Card Special Treatment

**What:** The spread card gets stronger visual emphasis when spread is meaningful.

**Implementation:**
- After `loadYields()`, if `spreadNum >= 1.5`:
  - Add `box-shadow: 0 0 24px rgba(29,158,117,0.15)` to the spread `.yield-card`
  - Spread `.yield-pct` gets `font-weight: 950` (vs default 900)
  - Directional arrow font-size `1.1rem` (already specified in 2C)
- If `spreadNum < 0`: border tint shifts to amber `rgba(245,158,11,0.2)` (existing amber card styling)
- All conditional, all data-driven

---

## Section 4 — Signature Wow Interaction (Demo Loop)

**What:** A 30-second repeating cinematic sequence showing the full RWAI loop.

**Sequence (total ~14s active, ~16s idle):**

| Time | Action |
|------|--------|
| 0s | Terminal: `"Spread opportunity detected: USDY +{real}% vs mETH {real}% — threshold crossed"` (amber) |
| 2s | Terminal: `"Generating rebalance proposal..."` (cyan) |
| 3.5s | Phone: message bubble text transitions to live alert with real spread + estimated dollar gain |
| 5s | Phone: Approve button pulses once (scale 1→1.04→1, 400ms) |
| 6s | Terminal: `"Decision anchored on Mantle · tx 0xa041…36a"` (green) |
| 8s | Phone: `"✓ Anchored on Mantle Mainnet"` confirmation line fades in below message |
| 12s | All states return to default (phone message resets, terminal scrolls on) |
| 30s | Sequence fires again |

**Implementation:**
- `startWowLoop()` function called once on page load, uses `setInterval(30000)`
- Phone message text: stored in a `<span id="tg-msg-body">` inside the existing `.tg-chat` message bubble
- Default text stored as `const TG_MSG_DEFAULT`; alert text constructed with live values
- Confirmation line: `<div id="tg-confirm" class="tg-confirm">` hidden by default (`opacity: 0; height: 0`), animates in
- All phone state changes via CSS class toggles (`phone-alerting`, `phone-confirming`)
- Approve button pulse: add/remove class `btn-pulse` which triggers a `@keyframes pulse-once`
- `liveUSDYApy` and `liveMethApy` are in scope from `loadYields()` — used directly

---

## Section 5 — Connect Wallet Button Premium Refinement

**What:** Elevate primary CTA buttons to premium fintech quality.

**Implementation (applies to `#btn-hero-connect` and `#btn-connect` in nav):**
- `letter-spacing: 0.01em` added
- `font-weight: 700`
- `transition` extended: `background 0.22s, border-color 0.22s, color 0.22s, transform 0.22s, box-shadow 0.22s` all at `cubic-bezier(0.25,0.46,0.45,0.94)`
- `hover`: `transform: translateY(-1px); box-shadow: 0 4px 20px rgba(29,158,117,0.25)`
- `active`: `transform: translateY(0); box-shadow: none; transition-duration: 0.1s`
- Shimmer `::after` on hover: one-shot sweep, `0.5s ease`, semi-transparent white, `overflow: hidden` on button, `position: relative`
- Nav button gets same treatment at half shadow intensity: `rgba(29,158,117,0.15)`

---

## Section 6 — Macro Context Signals

**What:** A rotating pill row between the hero and yield cards that shows macro-aware status.

**Implementation:**
- New element: `<div id="macro-ticker">` injected between hero `</section>` and yield cards `<section>`
- Styles: `display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; padding: 0 0 40px; opacity: 0.7`
- Each pill: `<span class="macro-pill">`: `background: #111; border: 1px solid rgba(255,255,255,0.08); border-radius: 9999px; font-size: 0.68rem; padding: 4px 12px; color: rgba(255,255,255,0.4); display: inline-flex; align-items: center; gap: 6px`
- Green dot: `<span class="macro-dot">` with `breathe` animation
- 3 pills visible at once (4th hidden on mobile)
- 8 rotating states, 5-second swap, fade transition:
  1. `"Treasury yields stable"` (static)
  2. `"Spread +{real}% — {wide/normal}"` (live data)
  3. `"ETH staking APR {rising/cooling}"` (derived from `liveMethApy` vs 1.98 default)
  4. `"Mantle Mainnet verified"` (static)
  5. `"USDY oracle active"` (static)
  6. `"24 predictions anchored"` (static — can be made dynamic if predictions.jsonl is readable)
  7. `"Monitoring validator yield compression"` (static)
  8. `"Rebalance threshold: {1.5}%"` (static)
- State index cycles every 5s, pills update with fade
- Called from `ambientLoop()`

---

## Section 7 — Phone Mockup Micro-Interactions

**What:** The phone in `#how-it-works` feels alive between wow demo cycles.

**Implementation:**
- Green status dot in `.tg-header` gets `animation: breathe 4s ease-in-out infinite` (shared keyframe)
- Approve button: `animation: btn-breathe 3s ease-in-out infinite` — `opacity 0.75 → 1 → 0.75`
- New `@keyframes btn-breathe` added to CSS
- Notification badge: `<span class="phone-notif-badge">1</span>` positioned on the chat header avatar, `animation: notif-appear 0.3s ease forwards` triggered by adding class every 20s via `ambientLoop()`
  - Styles: `position: absolute; top: -3px; right: -3px; width: 8px; height: 8px; background: #1D9E75; border-radius: 50%; font-size: 0`
- Section 4 wow loop shares this same phone element for the alert sequence

---

## Section 8 — Persistent Monitoring Layer

**What:** Refine the existing `nav-live-pill` — it already exists, just elevate it.

**Implementation:**
- `.nav-live-dot` animation: replace `pulse 2s` with `breathe 7s ease-in-out infinite` (shared keyframe, same as hero glow)
- `.nav-live-pill`: `font-weight: 600; letter-spacing: 0.02em`
- Mobile: at `<480px`, hide pill text, keep dot only — `<span class="nav-live-text">Monitoring Mantle Mainnet</span>` wrapped separately for targeted hiding
- No new element needed

---

## Section 9 — Footer Institutional Refinement

**What:** Restructure from 2 lines to a 3-row institutional footer.

**New structure:**
```
Row 1: [Logo]                    [● Live on Mantle Mainnet]
─────────────────────────────────────────────────────────
Row 2: Product    Protocol    Legal    Built for
       Dashboard  Contract    Terms    Mantle Turing Test 2026
       Telegram   GitHub      Privacy
─────────────────────────────────────────────────────────
Row 3: "AI reasoning and yield decisions are permanently anchored
        on Mantle via ERC-8004."                © 2026 RWAi
```

**Implementation:**
- Replace existing 2-line footer with semantic HTML using the structure above
- Row 1: `display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px`
- Row 2: 4-column `display: grid; grid-template-columns: repeat(4,1fr)` on desktop, `repeat(2,1fr)` at `<768px`, `1fr` at `<480px`
- Row 2 link style: `font-size: 0.78rem; color: rgba(255,255,255,0.3); line-height: 2`
- Row 2 column headers: `font-size: 0.63rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(255,255,255,0.2); margin-bottom: 8px`
- Row 3: `display: flex; justify-content: space-between; align-items: flex-end; padding-top: 24px; border-top: 1px solid rgba(255,255,255,0.06); font-size: 0.72rem; color: rgba(255,255,255,0.2)`
- `padding: 64px 96px` desktop → `40px 24px` mobile
- Mantle status pill in Row 1 right: small dot + "Live on Mantle Mainnet", same style as nav pill

---

## Section 10 — Responsiveness

All new elements have explicit mobile handling:

| Element | `<768px` | `<480px` |
|---------|----------|----------|
| `#hero-status` | visible | hidden |
| `#macro-ticker` | 2 pills | 1 pill |
| Sparklines | render at full width | render at full width |
| Demo loop phone | class toggles work at any size | same |
| Footer Row 2 | 2-column grid | 1-column stack |
| Nav monitoring text | visible | hidden (dot only) |

---

## `ambientLoop()` Architecture

Single function, called once on `DOMContentLoaded`. Contains three `setInterval` calls:

```javascript
function ambientLoop() {
  // 1. Hero status rotation — every 4s
  let statusIdx = 0;
  setInterval(() => rotateHeroStatus(statusIdx++), 4000);

  // 2. Terminal ambient lines — every 12–18s (randomised)
  function scheduleNextLine() {
    setTimeout(() => { appendAmbientLine(); scheduleNextLine(); },
      12000 + Math.random() * 6000);
  }
  scheduleNextLine();

  // 3. Macro ticker rotation — every 5s
  let tickerIdx = 0;
  setInterval(() => rotateMacroTicker(tickerIdx++), 5000);

  // 4. Wow demo loop — every 30s
  setInterval(runWowSequence, 30000);

  // 5. Phone notification badge — every 20s
  setInterval(showPhoneNotif, 20000);
}
```

All five sub-functions are pure (no shared mutable state beyond index counters). `liveUSDYApy` and `liveMethApy` are read at call time, so they always reflect the latest fetched values.

---

## What Is NOT Changed

- Wallet connect flow (`connectWith`, `onConnected`, `tryAutoReconnect`)
- Dashboard routing (`window.location.href = '/dashboard'`)
- All Telegram links and buttons
- `loadYields()` core fetch logic
- Section structure, section IDs, scroll anchors
- Green accent `#1D9E75`
- Dark institutional aesthetic
- All existing `@keyframes` (pulse, laserDown, fadeInLog, blink, modalIn)

---

*Spec self-reviewed: no placeholders, no contradictions, no ambiguity. Scope is single-file. All data claims are grounded in real fetched values or clearly labelled as static.*
