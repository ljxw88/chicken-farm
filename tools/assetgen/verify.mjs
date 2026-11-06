import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import ts from 'typescript';
import * as THREE from 'three';
import { assetPath, qualifiedPalette, root } from './config.mjs';
import { inspectGeometry } from './geometry.mjs';

export const sha256 = (content) => createHash('sha256').update(content).digest('hex');

const allowedImports = new Set(['three', '../../scene/farmPalette', '../../scene/farmPalette.ts',
  '../../scene/farmBuildingMaterials', '../../scene/farmBuildingMaterials.ts', '../types', '../types.ts']);
const forbiddenGlobals = new Set(['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker',
  'window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'process', 'globalThis', 'require', 'eval', 'Function']);

/** Restrict generated modules to local geometry and palettes before executing them. */
export function inspectSource(source, file = 'asset.ts') {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const failures = [];
  function add(message) {
    if (!failures.some((failure) => failure.message === message)) failures.push({ code: 'SOURCE_POLICY', message });
  }
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const name = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null;
      if (name && !allowedImports.has(name)) add(`Import ${name} is not permitted`);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) add('Dynamic imports are not permitted');
    if (ts.isIdentifier(node) && forbiddenGlobals.has(node.text)) add(`Global ${node.text} is not permitted`);
    if (ts.isPropertyAccessExpression(node) && node.expression.getText(parsed) === 'Math' && node.name.text === 'random') add('Math.random is not permitted');
    if (ts.isNumericLiteral(node) && /^0x/i.test(node.getText(parsed))) add('Use named palette keys, not hex literals');
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return failures;
}

export function compileAsset(path) {
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) return [ts.flattenDiagnosticMessageText(config.error.messageText, '\n')];
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const program = ts.createProgram([path], { ...parsed.options, noEmit: true });
  return ts.getPreEmitDiagnostics(program).slice(0, 30).map((diagnostic) => {
    const where = diagnostic.file && diagnostic.start !== undefined
      ? `${relative(root, diagnostic.file.fileName)}:${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1}: ` : '';
    return `${where}TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`;
  });
}

export async function loadSceneConstants(server) {
  const [{ FARM_PALETTE }, { BUILDING_PALETTE }, { createFarmLayout }, { createPlacementVisual }] = await Promise.all([
    server.ssrLoadModule('/src/scene/farmPalette.ts'), server.ssrLoadModule('/src/scene/farmBuildingMaterials.ts'),
    server.ssrLoadModule('/src/scene/createFarmLayout.ts'), server.ssrLoadModule('/src/placement/createPlacementVisual.ts'),
  ]);
  const scene = new THREE.Scene();
  createFarmLayout(scene);
  const fence = createPlacementVisual('fence');
  const height = (object) => new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3()).y;
  const references = {
    cottage: height(scene.getObjectByName('farm-cottage')),
    coop: height(scene.getObjectByName('farm-ramp-coop-1')),
    tree: height(scene.getObjectByName('farm-tree-2')),
    fence: height(fence),
  };
  return { palette: qualifiedPalette(FARM_PALETTE, BUILDING_PALETTE), references };
}

export async function verifyAsset(spec, bible, runner, constants) {
  const path = assetPath(spec);
  const report = { id: spec.id, category: spec.category, status: 'REJECTED', sourceHash: null,
    specHash: sha256(JSON.stringify(spec)), bibleHash: sha256(bible.text), failures: [], metrics: {} };
  let source;
  try {
    source = await readFile(path, 'utf8');
    report.sourceHash = sha256(source);
  } catch (error) {
    report.failures.push({ code: 'SOURCE_MISSING', message: String(error) });
    return { report, source: '', sheet: await runner.placeholder(spec, error) };
  }
  const policy = inspectSource(source, path);
  report.failures.push(...policy);
  const diagnostics = compileAsset(path);
  report.metrics.typescript = { passed: !diagnostics.length, diagnostics };
  if (diagnostics.length) report.failures.push({ code: 'COMPILE', message: diagnostics.join('\n') });
  if (policy.length || diagnostics.length) {
    return { report, source, sheet: await runner.placeholder(spec, report.failures.map((item) => item.message).join('\n')) };
  }
  try {
    const url = `/src/assets/${spec.category}/${spec.id}.ts`;
    const cached = runner.server.moduleGraph.getModuleById(path) || await runner.server.moduleGraph.getModuleByUrl(url);
    if (cached) runner.server.moduleGraph.invalidateModule(cached);
    const module = await runner.server.ssrLoadModule(url);
    const geometry = inspectGeometry(module, spec, bible.rules, constants.palette, constants.references);
    report.failures.push(...geometry.failures);
    report.metrics.geometry = geometry.metrics;
  } catch (error) {
    report.failures.push({ code: 'BUILD', message: String(error?.stack || error) });
    return { report, source, sheet: await runner.placeholder(spec, error) };
  }
  const visual = await runner.inspect(spec, bible.rules);
  report.failures.push(...visual.failures);
  report.metrics.visual = visual.metrics;
  report.status = report.failures.length ? 'REJECTED' : 'PASS';
  return { report, source, sheet: visual.sheet };
}
