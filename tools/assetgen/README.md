# Procedural farm asset generator

The source of truth for both the model and the hard gates is
`docs/asset-style-bible.md`. Specs live in `specs/<id>.json`. The default
generator invokes `~/.opencode/bin/opencode run --format json` with a fixed,
model-agnostic prompt; the selected OpenCode model is not hard-coded. It asks
for a TypeScript module rather than letting the model edit the worktree.
Revision prompts contain the preceding report and contact sheet. A separate
OpenCode critique receives the sheet and rubric; if image attachment fails,
it receives the numeric report instead. Image review is recorded, not assumed.

```sh
# Create a spec first, then generate (at most four rounds), verify, and bundle:
npm run asset:new -- tools/assetgen/specs/my-asset.json
npm run asset:verify -- my-asset
npm run asset:bundle
```

Each round has `prompt.txt`, the model transcript, `source.ts`, `report.json`,
`sheet.png`, and the critique transcript under `runs/<id>/round-N/`. The final
report records a score and whether the model actually reviewed the image.
Failed candidates are REJECTED, excluded from the registry and kept only in
the run log. `--force` preserves an existing source if replacement fails.

If non-interactive OpenCode is unavailable, `asset:new` writes
`runs/<id>/work-order.md`. To request this explicitly, use `--work-order`; let
an agent create the specified source, then run `npm run asset:new -- <id>
--check` to compile, verify and critique it. `ASSETGEN_IMAGES=0` forces numeric
critique for a text-only model. `OPENCODE_BIN` can select another binary without
changing the prompt. Reruns append rounds; they do not overwrite past evidence.

`asset:verify` performs the real Node and Chromium checks without another model
call. `asset:bundle` re-verifies each source and requires a passing loop report
for the exact source, spec and bible hashes before generating the registry,
manifest and gallery. It never deletes someone else's failed source. `npm run
asset:showcase` starts the isolated showcase at port 5185. Pixel/contrast and
scale floors are objective but deliberately insufficient as art direction;
the model and a human must still judge recognisability and style.
