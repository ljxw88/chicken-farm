import assert from 'node:assert/strict';
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Script } from 'node:vm';
import { JSDOM } from 'jsdom';
import { assembleSingleHtml, buildSingleHtml } from '../tools/export-single-html.mjs';

function fixture({ code = 'window.gameLoaded = true;', css = 'body { color: green; }', extra = '' } = {}) {
  return [
    { type: 'asset', fileName: 'index.html', source: `<!doctype html><html><head>
      <script type="module" src="./assets/game.js"></script>
      <link rel="stylesheet" href="./assets/game.css"><link rel="icon" href="data:,">
      </head><body><canvas id="scene"></canvas>${extra}</body></html>` },
    { type: 'chunk', fileName: 'assets/game.js', isEntry: true, imports: [], dynamicImports: [], code },
    { type: 'asset', fileName: 'assets/game.css', source: css },
  ];
}

test('the real Vite build produces one HTML document with inline game and styles', { timeout: 60000 }, async () => {
  const html = await buildSingleHtml();
  const dom = new JSDOM(html);
  try {
    const { document } = dom.window;
    assert.ok(document.querySelector('canvas#scene'));
    assert.equal(document.querySelectorAll('script').length, 1);
    const script = document.querySelector('script');
    assert.equal(script.hasAttribute('src'), false);
    assert.ok(script.textContent.length > 100000, 'The Three.js game bundle must be present');
    assert.doesNotThrow(() => new Script(script.textContent), 'No static module imports or exports');
    assert.ok(document.querySelector('style')?.textContent.length > 1000);
    assert.equal(document.querySelectorAll('link[rel="stylesheet"]').length, 0);
    for (const element of document.querySelectorAll('[src], [href]')) {
      for (const name of ['src', 'href']) {
        if (element.hasAttribute(name)) assert.match(element.getAttribute(name), /^(?:data:|#)/i);
      }
    }
  } finally {
    dom.window.close();
  }
});

test('data assets stay inline and CSS link attributes are preserved', () => {
  const files = fixture({ css: 'body { background: url("data:image/png;base64,AAAA"); }',
    extra: '<img src="data:image/png;base64,AAAA">' });
  files[0].source = files[0].source.replace('rel="stylesheet"', 'rel="stylesheet" media="screen"');
  const dom = new JSDOM(assembleSingleHtml(files));
  try {
    assert.equal(dom.window.document.querySelector('style').getAttribute('media'), 'screen');
    assert.match(dom.window.document.querySelector('style').textContent, /data:image\/png;base64,AAAA/);
    assert.equal(dom.window.document.querySelector('img').getAttribute('src'), 'data:image/png;base64,AAAA');
  } finally {
    dom.window.close();
  }
});

test('a large imported asset and a CSS asset are embedded by the real build', { timeout: 60000 }, async () => {
  let directory;
  try {
    try {
      directory = await mkdtemp('/tmp/opencode/ebr78-assets-');
    } catch (error) {
      if (!['EACCES', 'ENOENT'].includes(error.code)) throw error;
      directory = await mkdtemp(join(tmpdir(), 'ebr78-assets-'));
    }
    const bytes = Buffer.alloc(8192, 0xa5);
    const files = {
      'index.html': '<!doctype html><html><head></head><body><img id="out"><script type="module" src="/main.js"></script></body></html>',
      'main.js': 'import "./main.css"; import asset from "./large.png"; document.querySelector("#out").src = asset;',
      'main.css': 'body { background-image: url("./icon.svg"); }',
      'icon.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><path d="M0 0h1v1H0z"/></svg>',
      'large.png': bytes,
    };
    await Promise.all(Object.entries(files).map(([name, contents]) => writeFile(join(directory, name), contents)));
    const dom = new JSDOM(await buildSingleHtml(directory));
    try {
      assert.match(dom.window.document.querySelector('script').textContent, /data:image\/png;base64,/);
      assert.ok(dom.window.document.querySelector('script').textContent.includes(bytes.toString('base64')));
      assert.match(dom.window.document.querySelector('style').textContent, /data:image\/svg\+xml/);
      assert.equal(dom.window.document.querySelectorAll('script[src], link[rel="stylesheet"]').length, 0);
    } finally {
      dom.window.close();
    }
    await Promise.all(Object.keys(files).map((name) => unlink(join(directory, name))));
    await rmdir(directory);
    directory = undefined;
  } finally {
    if (directory) {
      for (const name of ['index.html', 'main.js', 'main.css', 'icon.svg', 'large.png']) {
        await unlink(join(directory, name)).catch((error) => { if (error.code !== 'ENOENT') throw error; });
      }
      await rmdir(directory);
    }
  }
});

test('module imports and exports are rejected, including dynamic imports', () => {
  for (const code of ['import x from "./chunk.js";', 'import (/* dynamic */ "./chunk.js");',
    'export const x = 1;', 'console.log(import.meta.url);']) {
    assert.throws(() => assembleSingleHtml(fixture({ code })), /module imports or exports|import\.meta/);
  }
  // Words in strings are not imports.
  assert.doesNotThrow(() => assembleSingleHtml(fixture({ code: 'window.label = "import( and export ";' })));
});

test('external or relative HTML and CSS resources fail closed', () => {
  for (const extra of ['<img src="https://example.com/a.png">', '<img src="/a.png">',
    '<a href="//example.com">link</a>', '<img srcset="a.png 1x">', '<base href="/">']) {
    assert.throws(() => assembleSingleHtml(fixture({ extra })), /External HTML resource|not supported/);
  }
  for (const css of ['@import "https://example.com/a.css";', 'body{background:url(../a.png)}',
    'body{background:url("https://example.com/a.png")}', 'body{background:image-set("a.png" 1x)}']) {
    assert.throws(() => assembleSingleHtml(fixture({ css })), /not self-contained|External CSS resource|not supported/);
  }
});

test('missing, extra, split, and unsafe outputs cannot produce a partial export', () => {
  const missing = fixture().filter((file) => file.fileName !== 'assets/game.css');
  assert.throws(() => assembleSingleHtml(missing), /Missing build resource/);
  assert.throws(() => assembleSingleHtml([...fixture(), { type: 'asset', fileName: 'assets/image.png', source: 'x' }]),
    /Uninlined build output/);
  const split = fixture();
  split[1].dynamicImports = ['assets/chunk.js'];
  assert.throws(() => assembleSingleHtml(split), /no module dependencies/);
  assert.throws(() => assembleSingleHtml(fixture({ code: 'window.x = "</script>";' })), /closing tag/);
  assert.throws(() => assembleSingleHtml(fixture({ css: 'body::after{content:"</style>"}' })), /closing tag/);
});
