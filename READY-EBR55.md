# EBR-55 — READY for Nest

- **Branch:** `feat/ebr55-interact`
- **Implementation tip:** `e5060adc92ecbe6bd2a390570698192811740383` (base `9c95f35438ac5ac4fb4ed786ed8516997d89ff6e`).
- The branch tip is the documentation-only commit containing this file; its full SHA is reported with the delivery. It cannot be embedded in itself.
- **Open (Tailscale):** [http://100.88.150.21:5276/](http://100.88.150.21:5276/). **On this host:** [http://127.0.0.1:5275/](http://127.0.0.1:5275/). Previews must be running; remote access depends on the tailnet. Worktree: `/home/michael/Developer/chicken-farm-ebr55-interact`. Restart instructions are in `DELIVER-EBR55.txt`.

## On-screen gate

No console, developer tools, URL parameters, or time/weather setup are needed. Use WASD, E, and clicks/taps:

1. From spawn, hold **S** toward the white chicken; release when **Feed chicken (stub)** appears. Walking into range alone must not feed it.
2. Press **E** or click the prompt. Expect **Fed chicken (QA stub). Feed: 0.**
3. Move right toward the egg (**S+D** works); use **Collect egg (stub)**. The egg disappears and feedback says **Collected egg (QA stub). Eggs: 1.**
4. Approach the bin in front of the barn and use **Open feed bin (stub)**. Its lid opens; feedback says storage and trade are not connected. Use the updated **Close feed bin (stub)** prompt to close it.
5. Approach the wooden sign to the right of the barn and use **Talk to sign (stub)**. Feedback shows **egg sale +3 coins; feed purchase -1 coin** and says trading is not connected.

Messages are brief. Refresh to reset the one free QA feed and egg. Clicking an object outside range only walks; entering its range never automatically interacts. Inventory, flock behavior, storage and trading are stubs, not real transactions.

Browser evidence and test details are in `DELIVER-EBR55.txt`; independent gameplay QA is pending. No merge or push.
