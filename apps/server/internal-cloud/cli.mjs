// Internal operator entry. Deliberately excluded from the self-hosted image.
import pg from 'pg';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { runtimeDatabaseConfig } from '../src/runtime-config.mjs';
import { activateCloudTenant, ensureCloudRuntimeLogin, initializeCloudDatabase, issueCloudBootstrapToken, prepareCloudTenant,
  provisionCloudTenant, readCloudTenants, reserveCloudTenant, setCloudTenantSeatLimit, setCloudTenantSuspension, verifyCloudDatabase,
  verifyCloudManagementLogin } from './operator.mjs';
import { verifyCloudRuntimeRole } from './scoped-pool.mjs';

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
const commandArity = new Map(Object.entries({ initialize: 0, deploy: 0, 'deploy-management': 0, verify: 0, reserve: 2, prepare: 1, bootstrap: 1,
  provision: 4, list: 0, inspect: 1, activate: 1, suspend: 1, resume: 1, 'set-seats': 2, 'setup-link': 1 }));
if (commandArity.get(command) !== args.length) {
  throw new Error(`Invalid arguments. Commands: ${[...commandArity.keys()].join(', ')}.`);
}

async function loadOpaqueSetupFactory() {
  if (!process.env.VAULTS_OPAQUE_NODE_MODULE) throw new Error('Reviewed OPAQUE module required.');
  const generated = await import(pathToFileURL(process.env.VAULTS_OPAQUE_NODE_MODULE).href);
  if (typeof generated.default === 'function') await generated.default();
  if (typeof generated.ExperimentalOpaqueBridge?.server_setup !== 'function') throw new Error('Reviewed OPAQUE setup unavailable.');
  return () => Buffer.from(generated.ExperimentalOpaqueBridge.server_setup());
}
const database = { ...runtimeDatabaseConfig(process.env), connectionTimeoutMillis: 3000, statement_timeout: 30000 };
const client = new pg.Client(database);
try {
  await client.connect();
  let result;
  if (command === 'initialize') result = await initializeCloudDatabase(client, region);
  else if (command === 'deploy' || command === 'deploy-management') {
    const management = command === 'deploy-management';
    const prefix = management ? 'VAULTS_CLOUD_MANAGEMENT_DATABASE' : 'VAULTS_CLOUD_RUNTIME_DATABASE';
    const user = process.env[`${prefix}_USER`];
    const runtimeDatabase = { ...database, ...runtimeDatabaseConfig({ ...process.env,
      VAULTS_DATABASE_USER: user,
      VAULTS_DATABASE_PASSWORD_FILE: process.env[`${prefix}_PASSWORD_FILE`]
    }) };
    if (!user || runtimeDatabase.user === database.user) {
      throw new Error('Cloud operator and runtime logins must differ.');
    }
    const schema = management ? await verifyCloudDatabase(client, region) : await initializeCloudDatabase(client, region, { allowInitialized: true });
    const login = await ensureCloudRuntimeLogin(client, runtimeDatabase, { management });
    const runtime = new pg.Client(runtimeDatabase);
    try {
      await runtime.connect();
      await (management ? verifyCloudManagementLogin(runtime) : verifyCloudRuntimeRole(runtime));
    } finally {
      await runtime.end();
    }
    result = { ...schema, ...login };
  }
  else if (command === 'verify') result = await verifyCloudDatabase(client, region);
  else if (command === 'list' || command === 'inspect') {
    result = { tenants: await readCloudTenants(client, { region, host: args[0] ?? null }) };
  } else if (command === 'provision') {
    result = await provisionCloudTenant(client, { region, host: args[0], maxActiveUsers: Number(args[1]),
      ownerIdentityId: args[2], ownerEmail: args[3], createOpaqueSetup: await loadOpaqueSetupFactory() });
  } else if (command === 'activate') result = await activateCloudTenant(client, { region, host: args[0] });
  else if (command === 'suspend' || command === 'resume') {
    result = await setCloudTenantSuspension(client, { region, host: args[0], suspended: command === 'suspend' });
  } else if (command === 'set-seats') {
    result = await setCloudTenantSeatLimit(client, { region, host: args[0], maxActiveUsers: Number(args[1]) });
  }
  else if (command === 'reserve') result = await reserveCloudTenant(client, { region, host: args[0], maxActiveUsers: Number(args[1]) });
  else if (command === 'prepare') {
    const createOpaqueSetup = await loadOpaqueSetupFactory();
    result = await prepareCloudTenant(client, { region, host: args[0], setupBytes: createOpaqueSetup() });
  } else {
    const output = process.env.VAULTS_CLOUD_BOOTSTRAP_OUTPUT;
    const keyPath = process.env.VAULTS_TOKEN_KEY_FILE;
    if (!output || !keyPath || await stat(output).then(() => true, error => error.code !== 'ENOENT')) {
      throw new Error('New restricted bootstrap output and token key paths required.');
    }
    const tokenKey = await readFile(keyPath);
    result = await issueCloudBootstrapToken(client, { region, host: args[0], tokenKey });
    const value = command === 'setup-link' ? result.setupUrl : result.token;
    await writeFile(output, `${value}\n`, { encoding: 'ascii', mode: 0o600, flag: 'wx' });
    result = { id: result.id, region, host: result.host, bootstrapTokenWritten: true };
  }
  console.log(JSON.stringify({ internalCloud: true, command, ...result }));
} catch {
  console.error('Internal Cloud operation failed.');
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
