import { mkdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { evidenceDirectory, goldenDirectory, root } from './config.mjs';

// Re-render from the retained recipes rather than depending on archived sheets.
const previewDir = `blocked-input-${randomBytes(6).toString('hex')}`;
execFileSync(process.execPath, [join(root, 'tools/assetgen/historical-preview.mjs')], {
  cwd: root, env: { ...process.env, ASSETGEN_PREVIEW_DIR: previewDir }, stdio: 'inherit', timeout: 300000,
});
const output = join(evidenceDirectory, 'ebr83-85', 'comparisons', previewDir);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  for (const id of ['barrel', 'hay-bale', 'round-oak']) {
    const sheet = await readFile(join(evidenceDirectory, 'ebr83-85', previewDir, id, 'sheet.png'));
    const reference = await readFile(join(goldenDirectory, 'img2threejs', `${id}.png`));
    await page.setContent(`<!doctype html><style>
      *{box-sizing:border-box}body{margin:0;background:#171e18;color:#f6e7ce;font:600 19px system-ui}
      h1{margin:0;padding:16px;height:62px;font-size:25px}.row{display:flex;gap:12px;padding:0 12px}
      .panel{width:622px;height:618px;border:2px solid #514633;position:relative;overflow:hidden;background:#283424}
      h2{margin:0;padding:9px 12px;font-size:18px;background:#211d18}.a{width:100%;height:auto;image-rendering:pixelated}
      .warning{padding:20px;line-height:1.5;color:#ffe1bb}.ref{height:220px;width:220px;object-fit:contain;background:#33432e;image-rendering:pixelated}
      .small{font-size:14px;color:#e6c6a0}
    </style><h1>${id} — comparison unavailable · current game lighting</h1><div class="row">
      <div class="panel"><h2>A — HISTORICAL, NEEDS HUMAN</h2><img class="a" src="data:image/png;base64,${sheet.toString('base64')}"><div class="warning small">Old generated candidate re-rendered with current game lights. Not a fresh loop result or approved asset.</div></div>
      <div class="panel"><h2>B — NO MODEL OR CONTACT SHEET</h2><div class="warning">OpenCode free-provider limit (HTTP 429). No quality or palette score can be assigned.<p class="small">Below is B's input only: an A-derived synthetic reference, not an independent B result.</p><img class="ref" src="data:image/png;base64,${reference.toString('base64')}"></div></div>
    </div>`);
    await page.screenshot({ path: join(output, `${id}-blocked.png`) });
  }
  console.log(`Comparison evidence: ${output}`);
} finally { await browser.close(); }
