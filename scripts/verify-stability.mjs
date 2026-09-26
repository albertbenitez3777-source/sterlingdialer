// Local release gate only. Never logs in, contacts a customer or activates calls.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const protectedFiles = JSON.parse(readFileSync(new URL('./phone-baseline.json', import.meta.url), 'utf8'));
for (const [path, expected] of Object.entries(protectedFiles)) {
  const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (actual !== expected) throw new Error(`Phone isolation gate failed: ${path} changed. Review before release.`);
}
for (const args of [
  ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.app.json'],
  ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.stability.config.ts'],
  ['node_modules/vite/bin/vite.js', 'build'],
]) {
  const status = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => resolve(code ?? 1));
  });
  if (status !== 0) process.exit(status);
}
console.log('Stability gate passed. Publication and real-device checks remain separate.');
