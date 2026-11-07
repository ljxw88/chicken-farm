import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

test('SaveV1 and hook shape reject invalid TypeScript assignments', () => {
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.state-tests.json'], { stdio: 'pipe' });
});
