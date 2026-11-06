# EBR-40 — Nest READY

- Branch: `feat/ebr40-cloudy` (local; no upstream configured).
- Implementation SHA: `ab17e9b21fefea673c2ec606ea2b8a3b6af6618d` (the following commit only records this SHA in the handoff).
- Branch tip SHA: `git rev-parse feat/ebr40-cloudy` (a committed file cannot contain its own commit SHA).

Run `npm ci`, then `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort`. No console is needed: open these URLs, or append the same queries to the Nest scene origin.

| Weather | Day | Night |
|---|---|---|
| Clear | [day](http://127.0.0.1:5173/?weather=clear&phase=daytime) | [night](http://127.0.0.1:5173/?weather=clear&phase=night) |
| Cloudy | [day](http://127.0.0.1:5173/?weather=cloudy&phase=daytime) | [night](http://127.0.0.1:5173/?weather=cloudy&phase=night) |
| Rain | [day](http://127.0.0.1:5173/?weather=rain&phase=daytime) | [night](http://127.0.0.1:5173/?weather=rain&phase=night) |

Wait about 2 seconds after opening each URL. The selected phase stays fixed; replace it with `morning` or `sunset` for the other phases, or omit `phase` to run the cycle. Clear restores the phase lighting; Cloudy is softly overcast with no rain; Rain has gentle streaks and splashes. At night the warm windows and lantern remain lit. WASD and ground clicks still move the character; barn, trees and pond remain solid.

Look Dev locked: directional x **0.72**, ambient/hemisphere RGB gains **0.86 / 0.96 / 1.08**, and **1.75 s smoothstep** blends. Window lights stay **0.85** each and the lantern **0.55** at night. No sky/fog tint changes are included. See `DELIVER-EBR40.txt` for details and verification.
