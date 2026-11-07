import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { parseAst } from 'rolldown/parseAst';
import postcss from 'postcss';
import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultOutput = resolve(root, 'dist/chicken-farm.html');

function checkJavaScript(code) {
  assert.doesNotMatch(code, /<\/script/i, 'A script closing tag cannot be safely embedded');
  const stack = [parseAst(code)];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    assert.ok(!['ImportDeclaration', 'ImportExpression', 'ExportNamedDeclaration', 'ExportDefaultDeclaration',
      'ExportAllDeclaration'].includes(node.type), 'The export must not contain module imports or exports');
    assert.ok(!(node.type === 'MetaProperty' && node.meta?.name === 'import'), 'The export must not use import.meta');
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) stack.push(...value);
      else if (value && typeof value === 'object') stack.push(value);
    }
  }
}

function localDataOrFragment(value) {
  return /^(?:data:|#)/i.test(value.trim());
}

function checkCss(css) {
  assert.doesNotMatch(css, /<\/style/i, 'A style closing tag cannot be safely embedded');
  const tree = postcss.parse(css);
  tree.walkAtRules((rule) => {
    assert.notEqual(rule.name.toLowerCase(), 'import', 'CSS imports are not self-contained');
  });
  const checkValue = (value) => {
    // image-set also accepts bare quoted URLs, which the url() check cannot cover.
    assert.doesNotMatch(value, /(?:-webkit-)?image-set\s*\(/i, 'CSS image-set is not supported in the export');
    for (const match of value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
      const url = match[1] ?? match[2] ?? match[3];
      assert.ok(localDataOrFragment(url), `External CSS resource: ${url}`);
    }
  };
  tree.walkDecls((declaration) => checkValue(declaration.value));
  tree.walkAtRules((rule) => checkValue(rule.params));
}

function emittedFile(reference, files) {
  const url = new URL(reference, 'https://export.invalid/');
  assert.equal(url.origin, 'https://export.invalid', `External build resource: ${reference}`);
  assert.equal(url.search + url.hash, '', `Unexpected query or fragment in build resource: ${reference}`);
  const name = decodeURIComponent(url.pathname.slice(1));
  const file = files.get(name);
  assert.ok(file, `Missing build resource: ${reference}`);
  return file;
}

/** Assemble only a single entry and its CSS; refuse anything that would need another file. */
export function assembleSingleHtml(output) {
  const files = new Map(output.map((file) => [file.fileName, file]));
  assert.equal(files.size, output.length, 'Duplicate build output names');
  const index = files.get('index.html');
  assert.equal(index?.type, 'asset', 'Build must emit index.html');
  const chunks = output.filter((file) => file.type === 'chunk');
  assert.equal(chunks.length, 1, 'Export requires exactly one JavaScript chunk');
  const chunk = chunks[0];
  assert.ok(chunk.isEntry && !chunk.imports.length && !chunk.dynamicImports.length,
    'Export must be a single entry with no module dependencies');
  checkJavaScript(chunk.code);

  const dom = new JSDOM(String(index.source));
  try {
    const { document } = dom.window;
    let scripts = 0;
    const consumed = new Set(['index.html']);
    for (const script of document.querySelectorAll('script[src]')) {
      const file = emittedFile(script.getAttribute('src'), files);
      assert.equal(file, chunk, 'Unexpected JavaScript entry');
      assert.equal(script.type, 'module', 'Expected the deferred Vite entry');
      script.removeAttribute('src');
      script.removeAttribute('crossorigin');
      script.textContent = chunk.code;
      consumed.add(file.fileName);
      scripts++;
    }
    assert.equal(scripts, 1, 'Expected exactly one entry script');

    for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
      const file = emittedFile(link.getAttribute('href'), files);
      assert.equal(file.type, 'asset', 'Expected an emitted stylesheet');
      assert.match(file.fileName, /\.css$/, 'Expected a CSS file');
      const css = String(file.source);
      checkCss(css);
      const style = document.createElement('style');
      for (const name of ['media', 'title']) {
        if (link.hasAttribute(name)) style.setAttribute(name, link.getAttribute(name));
      }
      style.textContent = css;
      link.replaceWith(style);
      consumed.add(file.fileName);
    }

    for (const script of document.querySelectorAll('script')) checkJavaScript(script.textContent);
    for (const style of document.querySelectorAll('style')) checkCss(style.textContent);
    for (const element of document.querySelectorAll('[style]')) checkCss(`x{${element.getAttribute('style')}}`);
    assert.equal(document.querySelectorAll('base, [srcset], object[data]').length, 0,
      'Base URLs, srcset and object resources are not supported in the export');
    for (const element of document.querySelectorAll('[src], [href], [poster]')) {
      for (const attribute of ['src', 'href', 'poster']) {
        if (element.hasAttribute(attribute)) {
          const value = element.getAttribute(attribute);
          assert.ok(localDataOrFragment(value), `External HTML resource: ${value}`);
        }
      }
    }
    for (const file of output) assert.ok(consumed.has(file.fileName), `Uninlined build output: ${file.fileName}`);
    return dom.serialize();
  } finally {
    dom.window.close();
  }
}

/** Build in memory so the normal multi-file Vite build remains unchanged. */
export async function buildSingleHtml(projectRoot = root) {
  const result = await build({
    root: projectRoot, configFile: false, publicDir: false, base: './',
    build: {
      write: false, modulePreload: false, assetsInlineLimit: () => true, cssCodeSplit: false,
      rolldownOptions: { output: { codeSplitting: false } },
    },
  });
  assert.ok(!Array.isArray(result), 'Expected one Vite build result');
  return assembleSingleHtml(result.output);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--out' || !args[1])) {
    throw new Error('Usage: node tools/export-single-html.mjs [--out <file.html>]');
  }
  const output = args.length ? resolve(args[1]) : defaultOutput;
  const html = await buildSingleHtml();
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, html);
  console.log(`Single-file export: ${output} (${Buffer.byteLength(html)} bytes)`);
}
