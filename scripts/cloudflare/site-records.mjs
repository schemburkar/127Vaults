import { createHash } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, saveJson, wranglerConfig } from './config.mjs';
import { readState, runWrangler } from './deploy.mjs';

export function recordFingerprints(rows) {
  return Object.fromEntries(rows.map(row => [row.id, createHash('sha256')
    .update(JSON.stringify([row.received_at, row.contact, row.trial, row.version])).digest('hex')]));
}
export function verifyRetainedRecords(before, after) {
  for (const [id, fingerprint] of Object.entries(before)) {
    if (after[id] !== fingerprint) throw Error('An existing access/license record changed during deployment; review the private baseline and backup');
  }
  return { preservedRecords: Object.keys(before).length, currentRecords: Object.keys(after).length };
}
export async function checkRecords(action, config, baselineFile, run = runWrangler) {
  const state = await readState(config), file = join(config.stateDirectory, `records-${crypto.randomUUID()}.json`);
  let rows;
  try {
    await saveJson(file, wranglerConfig(config, state, join(config.stateDirectory, 'unused-records-assets')));
    const result = JSON.parse(await run(['d1', 'execute', 'DB', '--remote', '--config', file, '--json', '--command',
      'SELECT id, received_at, contact, trial, version FROM access_requests ORDER BY id'], config, { capture: true }));
    if (!Array.isArray(result) || result.length !== 1 || result[0].success !== true || !Array.isArray(result[0].results)) throw Error('Could not verify retained D1 records');
    rows = recordFingerprints(result[0].results);
  } finally { await unlink(file); }
  if (action === 'snapshot') {
    await saveJson(baselineFile, { checkedAt: new Date().toISOString(), databaseId: state.databaseId, records: rows });
    return { baselineRecords: Object.keys(rows).length };
  }
  const baseline = JSON.parse(await readFile(baselineFile, 'utf8'));
  if (baseline.databaseId !== state.databaseId) throw Error('Database identity changed');
  return verifyRetainedRecords(baseline.records, rows);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, file, baseline] = process.argv.slice(2);
  if (!['snapshot', 'verify'].includes(action) || !file || !baseline) throw Error('Use site-records.mjs snapshot|verify <config> <private-baseline.json>');
  console.log(JSON.stringify(await checkRecords(action, await loadConfig(resolve(file)), resolve(baseline))));
}
