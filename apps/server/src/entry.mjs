// The sole executable inside the server image. The other modules provide commands.
const [command, action, ...extra] = process.argv.slice(2);
if (extra.length) throw new Error('Unexpected server arguments.');
// Cloud mode must never silently boot the single-installation server. The
// regional request, database, and restore boundaries are separate release gates.
if (process.env.VAULTS_ACCESS_MODE === 'regional-cloud') {
  throw new Error('Regional Cloud tenancy is not enabled by this server build.');
}
switch (command) {
  case 'relay':
    if (action) throw new Error('relay takes no action.');
    await (await import('./private-relay.mjs')).runPrivateRelay();
    break;
  case 'relay-healthcheck':
    if (action) throw new Error('relay-healthcheck takes no action.');
    await (await import('./private-relay.mjs')).runRelayHealthcheck();
    break;
  case 'serve':
    if (action) throw new Error('serve takes no action.');
    await (await import('./provision.mjs')).runProvision('initialize');
    if (process.exitCode) break;
    await import('./main.mjs');
    break;
  case 'provision':
    await (await import('./provision.mjs')).runProvision(action);
    break;
  case 'schema':
    await (await import('./migrate-schema.mjs')).runMigration(action);
    break;
  case 'healthcheck':
    if (action) throw new Error('healthcheck takes no action.');
    await (await import('./healthcheck.mjs')).runHealthcheck();
    break;
  default:
    throw new Error('Use serve, provision, schema, or healthcheck.');
}
