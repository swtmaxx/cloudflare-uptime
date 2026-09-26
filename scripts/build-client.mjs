import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const entryPath = resolve(root, 'src/main.js');

if (!existsSync(entryPath)) throw new Error('Missing src/main.js');

const result = spawnSync(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'build'], {
  cwd: root,
  stdio: 'inherit',
});
if (result.status !== 0) process.exit(result.status || 1);
