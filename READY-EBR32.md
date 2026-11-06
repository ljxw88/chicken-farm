# Ready — EBR-32

- Branch tip SHA: run `git rev-parse origin/main` (the handoff commit cannot contain its own SHA).
- Implementation commit: `e008c3024773cdd1d6575217e138d3d219646c69`.
- Start: `npm install && npm run dev`, then open the URL printed by Vite (normally http://localhost:5173/).
- Current preview: http://127.0.0.1:5176/ (ports 5173–5175 were already occupied).
- Walk: hold WASD relative to the screen, or click/tap the grass; keyboard movement cancels the clicked destination.
- Expected view: a small yellow character on gridded grass, followed by an orthographic isometric camera. The character stays on the ground.
- Herdr pane: `wH:p2 / ebr32-walk`.
- Verified: `npm run build`, `npm test`, and Chromium desktop/touch interaction checks.
