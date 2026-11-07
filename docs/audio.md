# Audio stubs

`src/audio/` owns an in-memory audio controller. `src/main.ts` creates it and
passes it to the sky HUD; it does not change the scene or the engine's render
loop. There are no audio files, playback, network requests, or saved settings.

The speaker starts off and dimmed. In a supported browser it remains focusable
and can be activated by click, tap, Enter, or Space; it is not falsely marked
disabled just because autoplay needs a gesture. The first activation creates
and, if needed, resumes an `AudioContext` inside that gesture. Once running,
the speaker shows **on**; subsequent activations alternate between **muted**
and **on**. A blocked or failed context stays dimmed and can be retried. If
neither `AudioContext` nor `webkitAudioContext` exists, the button is disabled
and says **Not available yet**. Reloading starts off again.

The controller exposes `getState()` (`locked`, `on`, `muted`, or
`unavailable`), `toggle()`, `subscribe(listener)` (returns an unsubscribe
function), and `dispose()`. `dispose()` closes a context if one was created and
invalidates pending activation. `playNature(asset?)` and `playMusic(asset?)`
are separate reserved hooks: currently they ignore even a supplied path, so
missing files are silent no-ops in every state.

## Adding ambience later

1. Add appropriately licensed nature and soft-music assets, for example under
   `public/audio/`, and map optional URLs to the two hooks in `src/audio/`.
2. Implement loading/decoding only after explicit activation. Treat an absent
   URL, failed HTTP response, decode error, or interrupted/blocked device as a
   silent no-op; do not log errors or create an unhandled rejection.
3. Use the gesture-unlocked context and separate gain/source nodes for nature
   and music. Stop or silence and disconnect sources on mute and disposal;
   cancel pending loads so they cannot start after muting. Keep settings
   transient unless persistence is separately requested.
4. Add tests for supplied and missing files, mute during loading, retry after a
   blocked gesture, cleanup, and browser accessibility. The current hooks do
   **not** load or play a URL merely because one is passed to them.
