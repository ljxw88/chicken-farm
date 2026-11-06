# EBR-59 — READY for Nest and Look Dev

- **Branch:** `feat/ebr57-59-supplies`; **base:** `5a611056205e8b980a4817e7da96358bfc191e0e` (the supplied Nest-PASSed EBR-57 tip). EBR-57 remains an ancestor; its inventory and chicken implementation are unchanged.
- **Implementation tip:** `b71dce07a6d38f3b7041f25680418d85efc2f34a`. This handoff is a documentation commit above it. For the documentation-inclusive tip, run `git rev-parse HEAD` in this worktree; the exact tip is also reported in the delivery. No push or merge.
- **Live preview:** [http://100.88.150.21:5278/](http://100.88.150.21:5278/) on Tailscale; [http://127.0.0.1:5278/](http://127.0.0.1:5278/) locally. The server must be running; remote access depends on the tailnet.
- To restart with Node 20.19+ or 22.12+: run `npm ci` if needed, `npm run build`, then `npm run preview -- --host 0.0.0.0 --port 5278 --strictPort` in `/home/michael/Developer/chicken-farm-ebr57-59-supplies`.

## Nest on-screen Success

No console, developer tools, URL parameters, or weather setup are required. The three action buttons are above the bottom-right inventory; the market sign and feed bin also offer the same sell/buy actions in range. Collapse Growing if it covers the world on a small screen.

1. Refresh: **Supplies 0, Feed ×5, Egg ×0**, and **Growing 1 ready**.
2. Hold **S** from spawn until **Feed chicken (stub)** appears; release and press **E** or click/tap the prompt. **Feed 5 → 4, Egg 0 → 1, Supplies 0**.
3. Click/tap Growing **Collect** (or collect the world egg in range). **Supplies 0 → 5** once; inventory stays **Feed 4 / Egg 1**. The world egg disappears and the list becomes **0 ready / Collected**.
4. Click/tap **Sell Egg**: **Egg 1 → 0, Supplies 5 → 8**.
5. Click/tap **Buy Feed**: **Supplies 8 → 7, Feed 4 → 5**.
6. Click/tap **Place Fence**: **Supplies 7 → 2** and one fence segment appears beside the chicken.
7. Click/tap **Sell Egg** again: the **can't sell** toast appears; counts do not change.
8. At Supplies 2, click/tap **Place Fence**: the **can't place fence** toast appears; counts do not change. Click **Buy Feed** twice to reach Supplies 0, then once more: the **can't buy Feed** toast appears and counts remain unchanged.
9. **+ Build** still opens its placeholder sheet and **×** closes it; WASD still works. Refresh restores **0 Supplies / 5 Feed / 0 Eggs / 1 ready** and removes the fence.

The fixed spot holds one decorative, nonblocking segment per session. If it is already placed and at least 5 Supplies remain, another attempt reports **already placed** without charging. With less than 5, the insufficient-Supplies toast takes precedence. There is no grid editor or full Build menu.

## Rates and scope

The signed [EBR-54 rates](https://linear.app/ebrietas/issue/EBR-54/design-playable-sim-vertical-slice-feed-eggs-sell) are remapped to the single **Supplies** currency:

| Action | Inventory | Supplies |
| --- | --- | ---: |
| Sell one inventory Egg | Egg −1 | +3 |
| Buy one Feed | Feed +1 | −1 |
| Place the fence stub | — | −5 |
| Collect the separate EBR-65 world egg | unchanged | +5 once |

There is no Coins counter, garden plot, flock AI, laying timer, save/load, or full Build menu. Economy, inventory and fence persist across day/night and weather within the session; refresh resets them. Optional `?weather=`, `?phase=`, and `?pixel=` wiring is not required by this gate and is a known non-fail on this fork.

## Verification and Look Dev

- `npm test`: **55 passing**. `npm run build`: passed with Vite's existing >500 kB bundle advisory. `npm run test:browser`: **15 Chromium checks passed**, covering world/list collect, transactions, failure toasts, exact-cost and duplicate placement, reset, weather/phase persistence, sign/bin interactions, Build and responsive layout.
- The live on-screen walkthrough against port 5278 recorded no browser errors: `/home/michael/Developer/chicken-farm-evidence/ebr59/nest-live.json` and `nest-live-01-start.png` through `nest-live-11-refresh.png`. `hud-proof.json`, `proof.json`, mobile captures and `23-economy-night-rain.png` are in the same directory. Independent EBR-59 Nest PASS remains pending.
- The market controls reuse EBR-65/57's HTML `rgba(40,55,36,0.68)` / `blur(16px)` frost and existing visual tokens; the fence uses the existing farm palette. No pixel postFX, diorama or weather settings were changed. Please check contrast and readability against the world in light/dark phases and on small screens; independent Look Dev sign-off remains pending.
