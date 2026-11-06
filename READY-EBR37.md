# EBR-37 — Nest READY

- Branch: `feat/ebr37-pixel`; tip: run `git rev-parse HEAD` for the full SHA.
- Run `npm run dev` and open its printed URL, or the current preview at http://127.0.0.1:5201/ while running.
- Pixel rendering is ON: 4 CSS-px nearest, about 320×180 at 1280×720; day/night remains readable and HTML stays crisp.
- Compare without a console: append `?pixel=0` for native rendering, then `?pixel=1` to restore pixel rendering.
- Look Dev greenlit 4 CSS-px; posterization and outlines are EBR-53.
