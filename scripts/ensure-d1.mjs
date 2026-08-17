import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const databaseName = 'cloudflare-uptime-db';

function run(args) {
  return execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] });
}

function parseJson(output) {
  const start = Math.min(...['[', '{'].map((character) => {
    const index = output.indexOf(character);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  }));
  if (!Number.isFinite(start)) return null;
  try { return JSON.parse(output.slice(start)); } catch { return null; }
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
const config = readFileSync(configPath, 'utf8');
const updated = config.replace(/("binding"\s*:\s*"DB"[\s\S]*?"database_id"\s*:\s*")[^"]+(")/, `$1${databaseId}$2`);
if (updated === config) throw new Error('Could not update database_id in wrangler.jsonc');
writeFileSync(configPath, updated);
console.log(`Using D1 ${databaseName} (${databaseId})`);
