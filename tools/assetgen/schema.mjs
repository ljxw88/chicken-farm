import { categories, idPattern } from './config.mjs';

const finite = Number.isFinite;
const vec = (value, n) => Array.isArray(value) && value.length === n && value.every(finite);
const positive = (value) => finite(value) && value > 0;
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const common = ['name', 'prim', 'mat', 'at', 'rot', 'scale', 'feature', 'exception', 'polygonOffset', 'seed', 'jitter'];
const primitives = {
  box: ['size'], cylinder: ['radiusTop', 'radiusBottom', 'h', 'segments'],
  cone: ['radius', 'h', 'segments'], sphere: ['radius', 'detail'], capsule: ['radius', 'length', 'segments'],
  wedge: ['size'], lathe: ['profile', 'segments'], extrude: ['polygon', 'depth'], custom: ['positions', 'indices'],
};

/** Fail-closed closed-vocabulary schema, before any recipe data reaches Three.js. */
export function validateRecipe(recipe, spec, rules, palette, accentTokens) {
  const failures = [];
  const fail = (message, code = 'H1') => failures.push({ code, message });
  const keys = (value, allowed, where) => {
    for (const key of Object.keys(value)) if (!allowed.includes(key)) {
      const vertexColors = /vertex.?colou?r|baked/i.test(key) ||
        (where.startsWith('part ') && /^colou?rs?$/i.test(key) && Array.isArray(value[key]));
      const code = vertexColors ? 'BAKED_LIGHT' : key === 'visible' && value[key] === false ? 'G_HIDDEN'
        : /texture|map|opacity|transparent|text|light/i.test(key) ? 'FORBIDDEN_FEATURE' : 'H1';
      fail(`${where}: forbidden or unknown field ${key}`, code);
    }
  };
  if (!object(recipe)) return [{ code: 'H1', message: 'Recipe must be an object' }];
  function nonFinite(value) {
    if (typeof value === 'number') return !finite(value);
    if (Array.isArray(value)) return value.some(nonFinite);
    return object(value) && Object.values(value).some(nonFinite);
  }
  if (nonFinite(recipe)) fail('Recipe contains NaN or infinite geometry values', 'G_NON_FINITE');
  keys(recipe, ['id', 'category', 'footprint', 'height', 'origin', 'facing', 'parts', 'anchors', 'collision', 'slots', 'tags', 'emissive', 'proposedTokens'], 'recipe');
  if (recipe.id !== spec.id || !idPattern.test(recipe.id) || recipe.category !== spec.category || !categories.includes(recipe.category)) fail('Recipe id/category must match the spec');
  if (!object(recipe.footprint) || !positive(recipe.footprint.w) || !positive(recipe.footprint.d)) fail('footprint needs positive w and d');
  else keys(recipe.footprint, ['w', 'd'], 'footprint');
  if (!positive(recipe.height)) fail('height must be positive');
  if (recipe.origin !== 'base-center') fail('origin must be base-center', 'H4');
  if (recipe.facing !== '+Z') fail('facing must be +Z, not -Z', 'H4');
  if (!object(recipe.slots)) fail('slots must be an object');
  const slots = object(recipe.slots) ? recipe.slots : {};
  for (const [key, value] of Object.entries(slots)) {
    if (!/^[a-z][a-z0-9.-]*$/.test(key) || typeof value !== 'string' || !Object.hasOwn(palette, value)) fail(`Invalid palette slot ${key}`);
  }
  const resolve = (token) => typeof token === 'string' ? slots[token] ?? token : null;
  if (!Array.isArray(recipe.parts) || !recipe.parts.length) return [...failures, { code: 'H1', message: 'parts must be a nonempty array' }];
  const names = new Set();
  const features = new Set(spec.identityFeatures.map((feature) => feature.id));
  const accentUsed = new Set();
  const families = new Map();
  for (const part of recipe.parts) {
    if (!object(part)) { fail('Each part must be an object'); continue; }
    const allowed = primitives[part.prim];
    if (!allowed) { fail(`Forbidden or unknown primitive ${String(part.prim)} (lights, text and textures are not allowed)`, 'FORBIDDEN_FEATURE'); continue; }
    keys(part, [...common, ...allowed], `part ${part.name || '?'}`);
    if (!idPattern.test(part.name || '') || names.has(part.name)) fail(`Invalid or duplicate part name ${String(part.name)}`);
    if (/baked|shadow|outline|light-side|shade-side/.test(part.name || '')) fail(`Part ${part.name} suggests baked lighting or an outline`, 'BAKED_LIGHT');
    names.add(part.name);
    const token = resolve(part.mat);
    if (!token || !Object.hasOwn(palette, token)) fail(`Part ${part.name} uses an unknown palette token ${String(part.mat)}`);
    const use = `${spec.id} ${spec.brief || ''}`.toLowerCase();
    const allowedUse = {
      'flower.red': /flower|mushroom|bush|berr/,
      'flower.yellow': /flower/,
      'flower.blue': /flower/,
      'flower.orange': /flower|mushroom/,
      pumpkin: /pumpkin/,
      metal: /axe|bucket|wheel|lantern/,
    };
    if (token && allowedUse[token] && !allowedUse[token].test(use)) fail(`Palette token ${token} is not approved for ${spec.id}`, 'H1');
    if (token === 'lantern.glow' && (spec.id !== 'lantern-post' || !/lantern.*glass|glass.*lantern/.test(part.name))) {
      fail(`lantern.glow is allowed only on lantern-post glass, not ${part.name}`, 'FORBIDDEN_FEATURE');
    }
    if (accentTokens.includes(token)) accentUsed.add(token);
    const family = /^(wood\.|trunk$|door$|timber$)/.test(token || '') ? 'wood'
      : /^(foliage\.|grass$)/.test(token || '') ? 'foliage'
        : /^(dirt\.|dirt$)/.test(token || '') ? 'soil'
          : /^(roof\.|roof$)/.test(token || '') ? 'roof' : /^(water\.|water$)/.test(token || '') ? 'water' : null;
    if (family && Object.hasOwn(palette, token)) {
      if (!families.has(family)) families.set(family, new Set());
      families.get(family).add(palette[token]);
    }
    if (!vec(part.at, 3) || (part.rot !== undefined && !vec(part.rot, 3))) fail(`Part ${part.name} needs finite position/rotation triples`);
    if (part.scale !== undefined && (!vec(part.scale, 3) || part.scale.some((n) => n <= 0) || Math.max(...part.scale) / Math.min(...part.scale) > rules.maxScaleRatio)) {
      fail(`Part ${part.name} has invalid, zero or excessive scale`, Array.isArray(part.scale) && part.scale.some((n) => n === 0) ? 'G_ZERO_SCALE' : 'H1');
    }
    if (part.feature !== undefined && !features.has(part.feature)) fail(`Part ${part.name} uses undeclared feature ${part.feature}`);
    if (part.exception !== undefined && (!['band', 'cleat', 'twine'].includes(part.exception) || !new RegExp(part.exception === 'band' ? 'band|hoop' : part.exception).test(part.name))) fail(`Part ${part.name} has an invalid small-feature exception`);
    if (part.polygonOffset !== undefined && typeof part.polygonOffset !== 'boolean') fail(`Part ${part.name} has invalid polygonOffset`);
    if (part.jitter !== undefined) {
      if (!object(part.jitter) || !Number.isInteger(part.seed)) fail(`Part ${part.name} jitter requires an integer seed`);
      else {
        keys(part.jitter, ['position', 'rotation'], `part ${part.name} jitter`);
        for (const amount of Object.values(part.jitter)) if (!finite(amount) || amount < 0 || amount > rules.jitterMaximum) fail(`Part ${part.name} jitter exceeds ${rules.jitterMaximum}`);
      }
    } else if (part.seed !== undefined && !Number.isInteger(part.seed)) fail(`Part ${part.name} seed must be an integer`);
    const size = part.size;
    if (['box', 'wedge'].includes(part.prim) && (!vec(size, 3) || size.some((n) => n <= 0))) fail(`Part ${part.name} needs positive size`);
    if (part.prim === 'cylinder' && (!positive(part.radiusTop) || !positive(part.radiusBottom) || !positive(part.h) || !integer(part.segments, 6, 8))) fail(`Part ${part.name} needs positive cylinder radii/height and 6–8 segments`);
    if (part.prim === 'cone' && (!positive(part.radius) || !positive(part.h) || !integer(part.segments, 6, 8))) fail(`Part ${part.name} has invalid cone dimensions or segment count (6–8)`);
    if (part.prim === 'sphere' && (!positive(part.radius) || ![0, 1].includes(part.detail))) fail(`Part ${part.name} has invalid sphere radius/detail`);
    if (part.prim === 'capsule' && (!positive(part.radius) || !positive(part.length) || !integer(part.segments, 6, 8))) fail(`Part ${part.name} has invalid capsule dimensions or segment count (6–8)`);
    if (part.prim === 'lathe' && (!Array.isArray(part.profile) || part.profile.length < 2 || part.profile.length > 32 ||
        !part.profile.every((point) => vec(point, 2) && point[0] >= 0) || !integer(part.segments, 6, 8) ||
        part.profile.some((point, i) => i > 0 && (point[1] < part.profile[i - 1][1] || (point[0] === 0 && part.profile[i - 1][0] === 0))))) fail(`Part ${part.name} has invalid lathe profile`);
    if (part.prim === 'extrude' && (!Array.isArray(part.polygon) || part.polygon.length < 3 || part.polygon.length > 32 || !part.polygon.every((point) => vec(point, 2)) || !positive(part.depth))) fail(`Part ${part.name} has invalid extrude polygon`);
    if (part.prim === 'custom' && (!Array.isArray(part.positions) || part.positions.length < 9 || part.positions.length > 30000 || part.positions.length % 3 ||
        !part.positions.every(finite) || !Array.isArray(part.indices) || part.indices.length < 3 || part.indices.length > 30000 || part.indices.length % 3 ||
        !part.indices.every((index) => Number.isInteger(index) && index >= 0 && index < part.positions.length / 3))) fail(`Part ${part.name} has invalid custom BufferGeometry`);
  }
  const allowedAccents = spec.id.includes('flower') ? 2 : 1;
  for (const [family, colors] of families) if (colors.size > 3) fail(`${family} uses more than three albedo tones`);
  if (accentUsed.size > allowedAccents) fail(`At most ${allowedAccents} accent token(s) per asset: ${[...accentUsed].join(', ')}`);
  if (!object(recipe.anchors) || Object.values(recipe.anchors).some((value) => !vec(value, 3))) fail('anchors must map names to finite triples');
  if (!object(recipe.collision) || !['box', 'none'].includes(recipe.collision.type)) fail('collision must have type box or none');
  else if (recipe.collision.type === 'box') {
    keys(recipe.collision, ['type', 'w', 'd', 'h'], 'collision');
    if (!['w', 'd', 'h'].every((key) => positive(recipe.collision[key]))) fail('box collision needs positive w, d and h');
  } else keys(recipe.collision, ['type'], 'collision');
  if (!Array.isArray(recipe.tags) || !recipe.tags.every((tag) => typeof tag === 'string')) fail('tags must be an array of strings');
  if (recipe.proposedTokens !== undefined && (!Array.isArray(recipe.proposedTokens) || recipe.proposedTokens.length)) fail('Unapproved proposedTokens cannot be built');
  if (!Array.isArray(recipe.emissive)) fail('emissive must be an array');
  else for (const accent of recipe.emissive) {
    if (!object(accent)) { fail('Invalid emissive accent'); continue; }
    keys(accent, ['part', 'mat', 'strength'], 'emissive');
    const token = resolve(accent.mat);
    if (!names.has(accent.part) || !Object.hasOwn(palette, token || '') || !finite(accent.strength) || accent.strength < 0 || accent.strength > 1) fail('Invalid emissive part/token/strength');
    if (spec.id !== 'lantern-post' || token !== 'lantern.glow' || !/lantern.*glass|glass.*lantern/.test(accent.part || '')) {
      fail('Emissive is forbidden except declared lantern-post glass with lantern.glow', 'BAKED_LIGHT');
    }
    if (accentTokens.includes(token)) accentUsed.add(token);
  }
  if (accentUsed.size > allowedAccents) fail(`At most ${allowedAccents} accent token(s) including emissive accents`);
  return failures;
}
