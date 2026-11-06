# EBR-65 — READY for Nest and Look Dev

- **Branch:** `feat/ebr65-collect`; base `d31c686b43c82034cc5259d89c0f48c6f582c8bf`.
- **Implementation tip:** `233a4b59293c4cf51762e50c4f8faa685dfeb64c`. This handoff is a documentation commit above it; run `git rev-parse HEAD` in the worktree for the documentation-inclusive tip (also reported in the delivery).
- **Open Vite:** [http://100.88.150.21:5277/](http://100.88.150.21:5277/) on Tailscale; [http://127.0.0.1:5277/](http://127.0.0.1:5277/) on this host. The server must be running; remote access depends on the tailnet. Worktree: `/home/michael/Developer/chicken-farm-ebr65-collect`.
- If needed, use Node 20.19+ or 22.12+, run `npm ci` in the worktree, then `npm run dev -- --host 0.0.0.0 --port 5277 --strictPort`.

## Nest on-screen gate

No console, developer tools, or URL parameters are needed.

1. On refresh, check **Supplies 0** and **Growing on your farm → 1 ready**. Woodland, Day 1 and Spring are placeholders; the phase follows the existing day/night cycle.
2. From spawn, hold **S** toward the white chicken and release when **Feed chicken (stub)** appears. Move toward the egg with **S+D** and release as soon as **Collect egg (stub)** appears. If you go past it, step back. On a small screen, collapse the Growing header to uncover the world; ground clicks/taps can also move the character.
3. Press **E**, click/tap the prompt, or click/tap the egg itself while in range. The egg disappears, **Supplies changes from 0 to 5**, and the list changes to **0 ready / Collected**. It cannot award another 5 from either path.
4. Refresh. From spawn, click/tap **Collect** in the Growing list instead; it intentionally works at any distance. The same egg disappears and Supplies again becomes **5**. Walking to its former position cannot collect it a second time.
5. Click/tap **+ Build** to open the placeholder sheet and close it with **×**. The spring and bee buttons disclose placeholder buff text. There is no real production timer, buff, building menu, persistence or economy; refresh resets the one egg and Supplies.

## Look Dev sign-off

Please visually sign the **olive frosted glass against the world** in light and dark phases: readability and contrast of the panel, count and controls; translucency/blur and the soft hairline edge; and fit on smaller screens. The current `rgba(40,55,36,0.68)` / 16px blur is a provisional starting point, not a locked final value. Phase screenshots and verification details are in `DELIVER-EBR65.txt`. Independent Nest and Look Dev sign-off remain pending.
