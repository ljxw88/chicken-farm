const diffRoots = ['src', 'tests', 'tools'];
const diffFiles = new Set(['index.html', 'package.json', 'package-lock.json']);

export function filterDiffNames(names) {
  return names.filter((name) => diffFiles.has(name) || diffRoots.some((root) => name === root || name.startsWith(`${root}/`)));
}

export function evidenceInGit(names) {
  const tracked = [...new Set(names.filter((name) => name === 'evidence' || name.startsWith('evidence/') ||
    name === 'handoffs' || name.startsWith('handoffs/') || /^DELIVER[^/]*\.txt$/.test(name)))];
  return { ok: tracked.length === 0, count: tracked.length, tracked };
}

// Node's test runner emits a TAP footer when stdout is piped. An incomplete
// final footer must not borrow counts from an earlier nested process.
export function parseTestCounts(output) {
  let counts = {};
  for (const match of output.matchAll(/^(?:#|ℹ)[ \t]*(tests|suites|pass|fail|cancelled|skipped|todo)[ \t]+(\d+)[ \t]*\r?$/gm)) {
    if (match[1] === 'tests') counts = {};
    counts[match[1]] = Number(match[2]);
  }
  return Number.isInteger(counts.tests) && Number.isInteger(counts.pass) && Number.isInteger(counts.fail) ? counts : null;
}
