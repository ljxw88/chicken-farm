# READY — EBR-41

- **Implementation tip:** `134f1ccd893307f19f49e5f45b2aa07716510521` (includes the phase URLs and Nest-ready steps).
- **Current branch/handoff tip:** run `git rev-parse HEAD` in `feat/ebr41-diorama` (a committed handoff cannot contain its own SHA).
- **Open:** run `npm ci`, `npm run build`, then `npm run preview -- --host 127.0.0.1 --port 15342 --strictPort`; open <http://127.0.0.1:15342/>.
- **Expected:** the 16 × 16 floating island, soil/rock rim and locked `#101416` void are visible by default.
- **Walk:** hold S from spawn to the foreground rim; the character stops at the edge. W+A or W+D moves along it.
- **Phase without console:** open <http://127.0.0.1:15342/?phase=morning>, <http://127.0.0.1:15342/?phase=daytime>, <http://127.0.0.1:15342/?phase=sunset>, or <http://127.0.0.1:15342/?phase=night>. A valid value holds the phase.
- **Look Dev:** greenlit. The 12 → 20 framing and thinner rain are accepted; framing polish is EBR-43.
- **Verified:** build, 36 tests and production-browser phase/rim checks. See `DELIVER-EBR41.txt` for evidence.
