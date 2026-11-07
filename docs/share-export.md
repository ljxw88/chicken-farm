# Shareable single-file build

With Node.js 20.19+ or 22.12+ and dependencies installed, run:

```sh
npm run build:export
```

Copy **`dist/chicken-farm.html`** by itself. Open it directly in a browser:
it does not need a server or an internet connection. The game, Three.js, styles,
and imported assets are embedded in the file. The build fails rather than
silently shipping external resources or a split JavaScript bundle. The regular
`npm run build` and development server are unchanged.

## Play on a phone on the same network

Build the file, then temporarily serve the `dist` directory on the computer:

```sh
python3 -m http.server 5251 --bind 0.0.0.0 --directory dist
```

On a phone that can reach the computer, visit
`http://<computer-IP>:5251/chicken-farm.html`. Use an address reachable from
the phone, allow the port through the local firewall if needed, and stop the
server with Ctrl-C afterwards. This simple server has no authentication; use
it only on a trusted network. Alternatively, transfer the same HTML file to a
device that allows local HTML to run in its browser.

Tap the ground to walk. For placement, tap **FREE Fence** or **Plot**, tap a
tile to preview, then use **Rotate** and **Place**; **Remove** and **Undo**
work as in the normal game. Desktop controls are unchanged.

## Checks

`npm test` checks the one-file build and rejects external references or module
imports; `npm run test:browser` also checks offline file loading and emulated
touch walking and placement from both the file and HTTP. The HTTP test binds
port 5251 by default; `EBR78_PORT` can select another free port, and
`EBR78_LAN_HOST` can select a reachable local address for the HTTP client.
These emulated tests do not establish physical-phone, iOS, other-browser, or
hardware-GPU compatibility.

For the EBR-78 exact-frame comparison, build the export from a clean committed
head and run `node tools/export-parity.mjs` after the standard pre-gate has
prepared its cached `a75e8db` baseline. It compares the untouched file opened
offline with that archived main served on port 5251: seed 123, 1280×720,
identical W-hold and fixed frame timestamps, day/sunset/night/rain, no mask,
exact RGBA. Frames, counts, environment and pose checks go under
`Shared/farm-evidence/EBR-78/<short-sha>/`. On the farm host, run build and test
jobs through `Shared/farm-tools/heavy`.
