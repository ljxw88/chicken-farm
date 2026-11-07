# Pre-gate

From a clean PR worktree, run:

```sh
node tools/pregate.mjs --pr-branch feat/my-branch --ebr EBR95
```

`EBR95` and `EBR-95` both select `EBR-95`. The command verifies the current
branch and a clean worktree, fetches and merges `origin/main`, then runs build,
unit tests, browser tests and the same-pose pixel gate through the shared
`heavy` wrapper. It does not push or stash, and refuses to overwrite ignored
files. A conflict stops the run, prints the paths, and leaves the merge for you
to resolve; it never resets or aborts it. Git needs an author identity if a merge
commit is required.

The clean-main snapshot is cached by full SHA in
`/home/michael/OpenBot/Shared/farm-evidence/_baseline/`. It is a `git archive`
with its own `npm ci` dependencies linked inside the cache. All archived Git
blobs and symlinks are verified before reuse; a modified or incomplete cache
fails closed. The baseline capture uses the first free port in 5211–5229 and
closes its server afterward. Exact commands and logs are retained with the run.

Results are written to
`/home/michael/OpenBot/Shared/farm-evidence/<EBR>/<short-sha>/pregate.json`;
individual runs and their logs remain under that directory's `runs/`. The JSON
records exit codes, test and pixel counts, HEAD/main SHAs, the requested diff
names, and tracked evidence/handoffs. Skipped steps have a null exit code.

For an approved per-ticket exception, pass `--masks /absolute/path/masks.json`.
The JSON maps scenario names to PNG paths relative to the JSON file, e.g.
`{"rain":"rain-mask.png"}`. Each mask must be 1280×720: non-black, nontransparent
pixels permit changes; black or transparent pixels do not. Unlisted scenarios
are unmasked. Pixel changes outside the masks and any pose/environment mismatch
still fail; the manifest and PNG hashes are recorded. Keep untracked masks
outside the worktree so the clean-worktree check remains meaningful.

The migrated capture/audit tools default to `/home/michael/OpenBot/Shared/farm-evidence/<tool>/`.
`EVIDENCE_DIR` selects an entire alternate output directory; existing
tool-specific overrides and positional output arguments take precedence.
Historical inputs used by tools are in `tools/fixtures/historical/` (69 files
from main `843c242`); other former tracked outputs, including delivery notes,
are at `/home/michael/OpenBot/Shared/farm-evidence/_main-archive-843c242/` with
their original relative paths. Historical lighting analyzers accept
`LIGHTING_INPUT_DIR` when comparing a different set of captures.
