// Internal operator entry. Deliberately excluded from the self-hosted image.
import pg from 'pg';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { runtimeDatabaseConfig } from '../src/runtime-config.mjs';
import { initializeCloudDatabase, issueCloudBootstrapToken, prepareCloudTenant, reserveCloudTenant, verifyCloudDatabase } from './operator.mjs';

const [command, ...args] = process.argv.slice(2);
if (process.env.VAULTS_INTERNAL_CLOUD_OPERATIONS !== '1' ||
    !process.env.VAULTS_DATABASE_HOST || !process.env.VAULTS_DATABASE_NAME ||
    process.env.VAULTS_DATABASE_NAME === 'vaults_experimental') {
  throw new Error('Internal Cloud operator environment is required.');
}
if (process.env.VAULTS_CLOUD_REGION && process.env.VAULTS_CLOUD_REGION !== 'global') {
  throw new Error('The first Cloud deployment uses the internal global location only.');
}
const region = 'global';
if (!['initialize', 'verify', 'reserve', 'prepare', 'bootstrap'].includes(command) ||
    (['reserve', 'prepare', 'bootstrap'].includes(command) ? args.length !== 1 : args.length !== 0)) {
  throw new Error('Use initialize, verify, reserve, prepare, or bootstrap <canonical-host>.');
}
const client = new pg.Client({ ...runtimeDatabaseConfig(process.env), connectionTimeoutMillis: 3000, statement_timeout: 30000 });
try {
  await client.connect();
  let result;
  if (command === 'initialize') result = await initializeCloudDatabase(client, region);
  else if (command === 'verify') result = await verifyCloudDatabase(client, region);
  else if (command === 'reserve') result = await reserveCloudTenant(client, { region, host: args[0] });
  else if (command === 'prepare') {
    if (!process.env.VAULTS_OPAQUE_NODE_MODULE) throw new Error('Reviewed OPAQUE module required.');
    const generated = await import(pathToFileURL(process.env.VAULTS_OPAQUE_NODE_MODULE).href);
    if (typeof generated.default === 'function') await generated.default();
    if (!generated.ExperimentalOpaqueBridge?.server_setup) throw new Error('Reviewed OPAQUE setup unavailable.');
    result = await prepareCloudTenant(client, { region, host: args[0],
      setupBytes: Buffer.from(generated.ExperimentalOpaqueBridge.server_setup()) });
  } else {
    const output = process.env.VAULTS_CLOUD_BOOTSTRAP_OUTPUT;
    const keyPath = process.env.VAULTS_TOKEN_KEY_FILE;
    if (!output || !keyPath || await stat(output).then(() => true, error => error.code !== 'ENOENT')) {
      throw new Error('New restricted bootstrap output and token key paths required.');
    }
    const tokenKey = await readFile(keyPath);
    result = await issueCloudBootstrapToken(client, { region, host: args[0], tokenKey });
    await writeFile(output, `${result.token}\n`, { encoding: 'ascii', mode: 0o600, flag: 'wx' });
    result = { id: result.id, region, host: result.host, bootstrapTokenWritten: true };
  }
  console.log(JSON.stringify({ internalCloud: true, command, ...result }));
} catch {
  console.error('Internal Cloud operation failed; no tenant has been activated.');
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
