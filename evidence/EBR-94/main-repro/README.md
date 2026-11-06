# EBR-94 baseline reproduction

Baseline: clean application source at `5d9ba48f6bd9bfbc3974351b50d0ce89934380ff`.
QA's unmodified `gate-g-sequences.mjs` completed two runs with no console
errors and did not naturally hit the intermittent pin; those frames and results
are in `../main-qa-sequences/`.

The deterministic browser regression follows that longer climb, descent and
three pad-side sequences, then uses a very short real W+D key interval to put
the return approach 8.58e-9 units outside z=0.55. This controls the edge rounding
instead of depending on frame scheduling. On main the return stopped at
`(7.999917157739378, 2.4, 0.5499999914215417)` instead of reaching the pad.
The baseline command exited 1 with the expected assertion failure:

```sh
/home/michael/OpenBot/Shared/farm-tools/heavy env \
  EBR46_URL=http://100.88.150.21:5214 EBR94_EVIDENCE_DIR=evidence/EBR-94/main-repro \
  node --test --test-concurrency=1 --test-name-pattern='longer QA stairs route' tests/browser/stairs.browser.mjs
```

`long-return.png` is the 1280x720 stalled frame; `long-return.json` records
the checkpoints, minimum height (0.16), frame count and browser errors (none).
