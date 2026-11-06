import { chromium } from 'playwright';
import { createServer } from 'vite';
import { root } from './config.mjs';

const escape = (text) => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export async function createVisualRunner() {
  const server = await createServer({ root, configFile: false, logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false } });
  await server.listen();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  } catch (error) {
    await server.close();
    throw error;
  }
  const port = server.httpServer.address().port;
  const url = `http://127.0.0.1:${port}`;

  async function sheet(spec, images, error) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    try {
      const names = ['FRONT • GRASS', 'SIDE • GRASS', '3/4 • PATH', 'GAME SCALE • SIGNED FARM'];
      const cells = names.map((name, index) => `<div class="cell">${images[index] ? `<img src="data:image/png;base64,${images[index].toString('base64')}">` : ''}<div class="caption">${escape(name)}</div></div>`).join('');
      await page.setContent(`<!doctype html><style>
        *{box-sizing:border-box}body{margin:0;background:#101416;color:#f2e6ce;font:600 19px system-ui,sans-serif}
        .grid{display:grid;width:1280px;height:720px;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr}
        .cell{position:relative;overflow:hidden;border:2px solid #382e23;background:#202b23}
        img{width:100%;height:100%;object-fit:fill;image-rendering:pixelated}
        .caption{position:absolute;left:12px;top:10px;padding:5px 9px;background:#201c19d9;letter-spacing:.04em;font-size:15px}
        .title{position:absolute;bottom:10px;left:12px;padding:6px 10px;background:#201c19e8}
        .error{position:absolute;left:40px;top:150px;max-width:1160px;background:#3d2722;padding:20px;white-space:pre-wrap;color:#fff}
      </style><div class="grid">${cells}</div><div class="title">${escape(spec.id)} · close views are zoomed; context uses game scale</div>${error ? `<div class="error">RENDER UNAVAILABLE: ${escape(error).slice(0, 1200)}</div>` : ''}`);
      return await page.screenshot({ type: 'png' });
    } finally {
      await page.close();
    }
  }

  async function inspect(spec, rules) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.goto(`${url}/tools/assetgen/inspect.html?id=${encodeURIComponent(spec.id)}&category=${encodeURIComponent(spec.category)}`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => !!window.__assetgen, null, { timeout: 15000 });
      const state = await page.evaluate(() => window.__assetgen.state());
      const samples = [];
      for (const view of ['front', 'side', 'iso']) for (const surface of ['grass', 'path']) {
        samples.push(await page.evaluate(({ view, surface, delta }) => window.__assetgen.measure(view, surface, delta),
          { view, surface, delta: rules.legibility.pixelDeltaRGB }));
      }
      const zoom = Math.min(10, 6 / Math.max(spec.size.height, spec.size.width * 0.7, spec.size.depth * 0.7));
      const images = [];
      for (const [view, surface, level] of [['front', 'grass', zoom], ['side', 'grass', zoom], ['iso', 'path', zoom], ['context', 'grass', 1]]) {
        await page.evaluate(({ view, surface, level }) => window.__assetgen.setView(view, surface, level), { view, surface, level });
        images.push(await page.screenshot({ type: 'png' }));
      }
      const failures = [];
      if (!state.pixel.enabled || state.pixel.canvasWidth !== 320 || state.pixel.canvasHeight !== 180 || state.pixel.cssPixelSize !== 4) {
        failures.push({ code: 'PIXEL_RENDER', message: `Expected the game's 320x180, 4 CSS-pixel pass: ${JSON.stringify(state.pixel)}` });
      }
      if (Object.values(state.references).some((value) => !value)) failures.push({ code: 'REFERENCE_SCENE', message: 'A signed reference is missing from the context scene' });
      for (const sample of samples) {
        const { pixels, widthPixels, heightPixels, meanContrastRGB, view, surface } = sample;
        if (pixels < rules.legibility.minimumPixels || widthPixels < rules.legibility.minimumSpanPixels ||
            heightPixels < rules.legibility.minimumSpanPixels || meanContrastRGB < rules.legibility.minimumMeanContrastRGB) {
          failures.push({ code: 'LEGIBILITY', message: `${view}/${surface}: ${pixels} changed pixels, ${widthPixels}x${heightPixels}, mean RGB contrast ${meanContrastRGB.toFixed(1)}` });
        }
      }
      if (errors.length) failures.push({ code: 'BROWSER', message: errors.join('; ') });
      return { failures, metrics: { samples, pixel: state.pixel, referencesInFrame: state.references, browser: browser.version(),
        camera: 'orthographic; front and side elevated; iso (12,12,12)', phase: 'daytime', screenshot: '1280x720 DPR 1' },
      sheet: await sheet(spec, images) };
    } catch (error) {
      const message = [String(error), ...errors].join('; ');
      return { failures: [{ code: 'BROWSER', message }], metrics: {}, sheet: await sheet(spec, [], message) };
    } finally {
      await page.close();
    }
  }

  return { server, browser, inspect, placeholder: (spec, error) => sheet(spec, [], error),
    close: async () => { await browser.close(); await server.close(); } };
}

export async function createBundleSheet(browser, assets, destination) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  try {
    const cells = assets.map(({ id, sheet, status }) => `<div class="tile"><img src="data:image/png;base64,${sheet.toString('base64')}"><div class="label">${escape(id)}${status === 'PASS' ? '' : ' · REJECTED'}</div></div>`).join('');
    const columns = Math.ceil(Math.sqrt(assets.length * 16 / 9));
    const rows = Math.ceil(assets.length / columns);
    await page.setContent(`<!doctype html><style>
      *{box-sizing:border-box}body{margin:0;background:#171c19;color:#fff4dd;font:600 14px system-ui,sans-serif}
      .grid{display:grid;width:1280px;height:720px;grid-template-columns:repeat(${columns},1fr);grid-template-rows:repeat(${rows},1fr)}
      .tile{position:relative;overflow:hidden;border:1px solid #40392f;background:#30402c}.tile img{position:absolute;width:200%;height:200%;max-width:none;left:-100%;top:0;image-rendering:pixelated}
      .label{position:absolute;bottom:3px;left:3px;right:3px;background:#201c19db;padding:3px 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    </style><div class="grid">${cells}</div>`);
    await page.screenshot({ path: destination });
  } finally {
    await page.close();
  }
}
