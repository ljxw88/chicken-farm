# EBR-57 — READY for Nest and Look Dev

- **Scope:** EBR-57 inventory only. EBR-59 remains **Todo until Nest PASSes EBR-57**.
- **Branch:** `feat/ebr57-59-supplies` (name retained); base `4692dbdbbb0e3a6261e887a9b579f9d52a3c3c36`.
- **Implementation tip:** `664b6c7cd82de7712c8eb8bae976b4007573b37c`. This handoff is a documentation commit above it. Run `git rev-parse HEAD` in the worktree for the documentation-inclusive tip; no merge or push.
- **Preview:** [http://100.88.150.21:5278/](http://100.88.150.21:5278/) on Tailscale; [http://127.0.0.1:5278/](http://127.0.0.1:5278/) on this host. The server must be running; remote access depends on the tailnet.
- To restart, use Node 20.19+ or 22.12+, run `npm ci` if needed, then `npm run build` and `npm run preview -- --host 0.0.0.0 --port 5278 --strictPort` in `/home/michael/Developer/chicken-farm-ebr57-59-supplies`.

## EBR-57 success and Nest on-screen gate

**Success:** Feed and Egg stacks have session-only pickup/consume hooks; feeding spends one Feed and stub-grants one inventory Egg. The separate EBR-65 world egg still awards +5 Supplies once.

No console, developer tools, URL parameters, or weather setup are needed.

1. Refresh. Check **Supplies 0**, the bottom-right inventory **Feed ×5 / Egg ×0**, and **Growing on your farm → 1 ready**. The world QA egg is still present. Collapse the Growing header if it covers the world on a small screen.
2. From spawn hold **S** toward the white chicken, release when **Feed chicken (stub)** appears, then press **E** or click/tap the prompt. Check **Feed 5 → 4**, **Egg 0 → 1**, and Supplies stays **0**. Release E between presses.
3. Click/tap **Collect** in the Growing list (it works at any distance). Supplies goes **0 → 5**, the world egg disappears, and the list becomes **0 ready / Collected**. Inventory remains **Feed 4 / Egg 1**; the same world egg cannot award again.
4. Still by the chicken, press E four more times: **Feed 4 → 0**, **Egg 1 → 5**. Press E once more: the toast says **“Can't feed: no Feed left. Refresh to restock.”** Feed, Eggs and Supplies do not change.
5. Check **+ Build** opens its existing placeholder sheet and close it with **×**. WASD still moves the character. Refresh resets all counts and restores the one world egg.
6. As an alternative collect path, refresh, approach the chicken with **S**, then move toward the egg with **S+D**. Use **E**, the prompt, or the egg itself while in range. Supplies again goes **0 → 5** once, the list Collect becomes disabled, and inventory Egg remains **0** if the chicken was not fed.

| Action | Feed | Inventory Egg | Supplies |
| --- | ---: | ---: | ---: |
| Fresh load | 5 | 0 | 0 |
| Feed chicken | −1 | +1 stub | 0 |
| Collect world egg | 0 | 0 | +5 once |
| Feed with no Feed | 0 | 0 | 0 |

Inventory and Supplies persist across day/night and weather changes only during the current session. There is no save, egg-laying timer, flock AI, buying, selling, paid placement, or full Build menu. The existing sign's historical rate text is informational only; the feed bin only opens/closes and does not buy Feed.

## Verification and Look Dev

- `npm test`: **49 passing**. `npm run build`: passed with Vite's existing >500 kB bundle advisory. `npm run test:browser`: **13 Chromium checks passed**, including E/prompt/object/list collection, feed exhaustion, no-double reward, reset, phase/weather persistence, Build and small-screen layouts; no happy-path browser errors.
- A Playwright walkthrough against the actual Tailscale preview used only on-screen controls: `/home/michael/Developer/chicken-farm-evidence/ebr57/nest-preview.json` and `nest-preview-01-start.png` through `nest-preview-05-build-stub.png`. Automated evidence, including a night/rain comparison, is in the same directory. Human Nest PASS remains pending.
- The inventory strip is HTML inside the HUD sibling of the canvas, outside the pixel pass. It reuses the EBR-65 tip's `rgba(40,55,36,0.68)` / `blur(16px)` frost without changing world, postFX or weather settings. Please sign off readability and contrast against light/dark world phases and at small sizes; independent Look Dev sign-off remains pending.
