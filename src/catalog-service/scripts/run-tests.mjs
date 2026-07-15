import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function testFiles(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${dir}/${entry.name}`;
      return entry.isDirectory() ? testFiles(path) : path.endsWith('.test.js') ? [path] : [];
    })
    .sort();
}

const dist = fileURLToPath(new URL('../dist', import.meta.url));
const files = testFiles(dist);
if (files.length === 0) {
  throw new Error('no compiled catalog tests found');
}
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
