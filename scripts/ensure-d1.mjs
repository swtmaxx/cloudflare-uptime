import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const databaseName = 'cloudflare-uptime-db';

function run(args) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return execFileSync(npx, ['wrangler', ...args], { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] });
}

function parseJson(output) {
  const clean = output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
  for (let index = 0; index < clean.length; index += 1) {
    if (clean[index] !== '[' && clean[index] !== '{') continue;
    try { return JSON.parse(clean.slice(index)); } catch { /* Try the next JSON boundary. */ }
  }
  return null;
}

function findDatabase(value) {
  const entries = Array.isArray(value) ? value : value?.result || value?.databases || [];
  return Array.isArray(entries) ? entries.find((item) => item?.name === databaseName) : null;
}

let database = findDatabase(parseJson(run(['d1', 'list', '--json'])));
if (!database) {
  run(['d1', 'create', databaseName]);
}
if (!database) database = findDatabase(parseJson(run(['d1', 'list', '--json'])));

const databaseId = database?.uuid || database?.database_id || database?.id;
if (!databaseId) throw new Error(`Unable to find D1 database: ${databaseName}`);

const configPath = 'wrangler.jsonc';
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const binding = config.d1_databases?.find((item) => item?.binding === 'DB');
if (!binding) throw new Error('Could not find the DB D1 binding in wrangler.jsonc');
binding.database_id = databaseId;
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Using D1 ${databaseName} (${databaseId}) for binding DB`);
