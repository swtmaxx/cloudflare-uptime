import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
const binding = config.d1_databases?.find((item) => item?.binding === 'DB');
const databaseId = binding?.database_id;
const placeholder = '00000000-0000-0000-0000-000000000000';

if (!binding || typeof databaseId !== 'string' || !databaseId || databaseId === placeholder) {
  throw new Error('D1 binding DB is missing a real database_id in wrangler.jsonc');
}

console.log(`Verified D1 binding DB (${databaseId})`);
