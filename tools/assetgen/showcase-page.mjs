const escape = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const list = (items) => items?.length ? `<ul>${items.map((item) => `<li>${escape(typeof item === 'string' ? item : `${item.code}: ${item.message}`)}</li>`).join('')}</ul>` : '<p>None recorded.</p>';
const fmt = (value) => value == null ? 'Not measured' : escape(typeof value === 'object' ? JSON.stringify(value) : value);

function assetCard(asset) {
  const files = new Set(asset.pack?.files || []);
  const prefix = `images/${asset.id}`;
  const image = (filename, alt) => files.has(filename) ? `<figure><img loading="lazy" src="${escape(prefix)}/${escape(filename)}" alt="${escape(alt)}"><figcaption>${escape(alt)}</figcaption></figure>` : '';
  const checks = Array.from({ length: 10 }, (_, index) => {
    const id = `H${index + 1}`, value = asset.checks?.[id];
    return `<tr><th>${id}</th><td>${value === true ? 'pass' : value === false ? 'FAIL' : 'not measured'}</td></tr>`;
  }).join('');
  const allFrames = ['daytime', 'sunset', 'night'].every((phase) => Array.from({ length: 8 }, (_, index) =>
    files.has(`${phase}-grass-${String(index * 45).padStart(3, '0')}.png`)).every(Boolean));
  const turntable = allFrames ? `<div class="controls"><label>Light <select data-phase><option>daytime</option><option>sunset</option><option>night</option></select></label>
    <label>Yaw <select data-yaw>${Array.from({ length: 8 }, (_, i) => `<option value="${String(i * 45).padStart(3, '0')}">${i * 45}°</option>`).join('')}</select></label></div>
    <div class="frame-scroll"><img class="turntable" data-turntable data-prefix="${escape(prefix)}" src="${escape(prefix)}/daytime-grass-000.png" alt="${escape(asset.id)} game pixel-pass turntable, shown at 3× nearest-neighbour"></div>` : '<p class="missing">Full 24-frame turntable unavailable.</p>';
  const scores = asset.criticScores ? Object.entries(asset.criticScores).map(([key, value]) => `<tr><th>${escape(key)}</th><td>${fmt(value)} / 5</td></tr>`).join('') : '<tr><td>Visual critique not run; no scores.</td></tr>';
  const visualChecks = asset.visualChecks ? Object.entries(asset.visualChecks).map(([key, value]) => `<tr><th>${escape(key)}</th><td>${escape(value)}</td></tr>`).join('') : '<tr><td>Not run.</td></tr>';
  return `<article class="asset" id="${escape(asset.id)}"><header><div><span class="tag">P0 · SOLO REVIEW</span><h2>${escape(asset.id)}</h2></div><strong class="status">${escape(asset.status || 'not generated')}</strong></header>
    <p>${escape(asset.brief)}</p><p><strong>Render:</strong> ${escape(asset.pack?.kind || 'unavailable')} ${asset.pack?.kind === 'diagnostic' ? '— hard-failed diagnostic only, not a verification pass.' : ''}</p>
    <p><strong>Triangles:</strong> ${fmt(asset.triangles)} · <strong>Measured colour count:</strong> ${fmt(asset.colorCount)} · <strong>Palette tokens:</strong> ${asset.colors?.length ? escape(asset.colors.join(', ')) : 'Not measured'} · <strong>Bounds:</strong> ${fmt(asset.bounds)} · <strong>Metrics source:</strong> ${escape(asset.metricSource || 'not measured')}</p>
    <p><strong>Rounds:</strong> ${fmt(asset.rounds)} · <strong>Critique:</strong> ${escape(asset.critiqueStatus || 'visual critique not run')}</p>
    ${turntable}
    <div class="sheet">${image('sheet.png', `${asset.id}: 8 yaws × daytime, sunset, night; 3× pixel crops and signed-farm context`)}</div>
    <details><summary>Silhouettes, scale composites and native debug</summary><div class="figures">
      ${image('silhouette-front-grass.png', 'Black front silhouette on grass · 320×180')}
      ${image('silhouette-side-grass.png', 'Black side silhouette on grass · 320×180')}
      ${image('silhouette-front-path.png', 'Black front silhouette on path · 320×180')}
      ${image('silhouette-side-path.png', 'Black side silhouette on path · 320×180')}
      ${image('composite-daytime.png', 'Daytime scale composite with signed farm and character')}
      ${image('composite-night.png', 'Night scale composite with signed farm and character')}
      ${image('native-debug.png', 'Pixel pass OFF · debugging only')}
    </div></details>
    <details><summary>Every hard check, failures, unmeasured checks and critic scores</summary>
      <div class="tables"><table><caption>Hard checks</caption>${checks}</table><table><caption>Measured visual checks</caption>${visualChecks}</table><table><caption>Critic scores</caption>${scores}</table></div>
      <h3>Failures / blockers</h3>${list(asset.failures)}<h3>Warnings</h3>${list(asset.warnings)}<h3>Unmeasured</h3>${list(asset.unmeasured)}
      ${asset.reportHref ? `<p><a href="${escape(asset.reportHref)}">Full verifier report (JSON)</a></p>` : ''}
      ${asset.diagnosticHref ? `<p><a href="${escape(asset.diagnosticHref)}">Diagnostic render measurements (not an approval)</a></p>` : ''}
    </details></article>`;
}

/** Static, escaped review page; missing evidence is always shown as missing. */
export function renderShowcasePage({ assets, overview, generatedAt }) {
  const overviewPanel = overview?.available ? `<div class="controls"><label>Light <select id="island-phase"><option>daytime</option><option>sunset</option><option>night</option></select></label>
    <label>Orbit <select id="island-yaw">${Array.from({ length: 8 }, (_, i) => `<option value="${String(i * 45).padStart(3, '0')}"${i === 1 ? ' selected' : ''}>${i * 45}°</option>`).join('')}</select></label></div>
    <img id="island" class="island" src="images/island/daytime-045.png" alt="P0 review candidates on the signed island; orbit and light controls select pre-rendered views">
    <p>Shown on the review row in increasing world X: ${escape(overview.included.join(', ') || 'none')}. Not renderable: ${escape(overview.missing.join(', ') || 'none')}.</p>` : '<p class="missing">Island overview unavailable; see individual evidence below.</p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>P0 Asset Forge · Look Dev review</title>
<style>
  :root{color-scheme:dark;--ink:#f5e7cb;--muted:#cbbca0;--bg:#171d18;--panel:#253126;--line:#596b4c;--warn:#ffd18a}*{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,sans-serif}main{max-width:1380px;margin:auto;padding:24px}h1,h2,h3{line-height:1.15}h1{font-size:clamp(1.8rem,4vw,3rem);margin:.2em 0}h2{margin:.3em 0}a{color:#ffd28c}nav{display:flex;flex-wrap:wrap;gap:10px}.intro,.asset,.overview{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:20px;margin:18px 0}.warning,.missing{color:var(--warn)}.tag{font-size:.75rem;font-weight:800;letter-spacing:.08em;color:#c3e8a8}.status{color:#ffd18a;text-transform:uppercase}.asset header{display:flex;justify-content:space-between;gap:20px}.controls{display:flex;gap:18px;flex-wrap:wrap;margin:12px 0}select{font:inherit;background:#101813;color:var(--ink);border:1px solid var(--line);border-radius:5px;padding:4px 8px}.island,.sheet img{display:block;width:100%;height:auto;image-rendering:pixelated}.frame-scroll{max-width:100%;overflow:auto;background:#101813}.turntable{display:block;width:960px;height:540px;max-width:none;image-rendering:pixelated}.figures{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}.figures figure,.sheet figure{margin:12px 0}.figures img{width:100%;height:auto;image-rendering:pixelated}figcaption{color:var(--muted);font-size:.85rem}details{border-top:1px solid var(--line);padding:12px 0}summary{cursor:pointer;font-weight:700}.tables{display:flex;gap:32px;flex-wrap:wrap}table{text-align:left;border-collapse:collapse}th,td{padding:3px 14px 3px 0;vertical-align:top}caption{text-align:left;font-weight:700}li{overflow-wrap:anywhere}
</style></head><body><main><section class="intro"><span class="tag">LOOK DEV · P0 CALIBRATION ONLY</span><h1>Asset Forge review</h1>
<p class="warning"><strong>Review evidence only.</strong> No candidate is signed or placed in the game registry. Hard failures, missing renders and unmeasured visual checks are not passes. Look Dev reviews P0 alone before P1/P2.</p>
<p>Generated ${escape(generatedAt)}. Orbit uses eight fixed game-camera renders; phase controls use the merged game lighting.</p><nav>${assets.map((asset) => `<a href="#${escape(asset.id)}">${escape(asset.id)}</a>`).join('')}</nav></section>
<section class="overview"><h2>P0 on the island</h2>${overviewPanel}</section>${assets.map(assetCard).join('')}</main>
<script>
  document.querySelectorAll('.asset').forEach(card=>{const image=card.querySelector('[data-turntable]');if(!image)return;const phase=card.querySelector('[data-phase]'),yaw=card.querySelector('[data-yaw]');const update=()=>{image.src=image.dataset.prefix+'/'+phase.value+'-grass-'+yaw.value+'.png'};phase.addEventListener('change',update);yaw.addEventListener('change',update)});
  const island=document.querySelector('#island');if(island){const phase=document.querySelector('#island-phase'),yaw=document.querySelector('#island-yaw');const update=()=>{island.src='images/island/'+phase.value+'-'+yaw.value+'.png'};phase.addEventListener('change',update);yaw.addEventListener('change',update)}
</script></body></html>`;
}
