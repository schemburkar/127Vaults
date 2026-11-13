import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, relative, isAbsolute, dirname } from 'node:path';
import { lstat, readFile, readdir, mkdir, writeFile, unlink } from 'node:fs/promises';

const contract=JSON.parse(readFileSync(new URL('../apps/cli/src/namespace-contract.json',import.meta.url),'utf8'));
// Rust clients embed the same contract.
export function runtimeNamespace(env = process.env, { launcher = false, configRoot } = {}) {
  const name = env.VAULTS_NAMESPACE ?? env.VAULTS_BUILD_NAMESPACE ?? (launcher ? 'development' : undefined);
  if(env.VAULTS_BUILD_TEST_INSTANCE && env.VAULTS_TEST_INSTANCE && env.VAULTS_BUILD_TEST_INSTANCE!==env.VAULTS_TEST_INSTANCE)throw Error('Build and runtime test instances conflict.');
  const instance = env.VAULTS_TEST_INSTANCE ?? env.VAULTS_BUILD_TEST_INSTANCE;
  if (!['production', 'development', 'test'].includes(name)
    || (name === 'test' ? !/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(instance ?? '') : instance !== undefined))
    throw Error('Select VAULTS_NAMESPACE=production|development|test; test requires VAULTS_TEST_INSTANCE (1-40 lowercase letters/digits/hyphens).');
  if (launcher && name === 'production') throw Error('Development launchers cannot target production.');
  if (env.VAULTS_BUILD_NAMESPACE && env.VAULTS_BUILD_NAMESPACE !== name) throw Error('Build and runtime namespaces conflict.');
  const id = name === 'test' ? `test-${instance}` : name;
  const base = configRoot ?? (process.platform === 'win32' ? env.APPDATA ?? join(homedir(),'AppData/Roaming')
    : process.platform === 'darwin' ? join(homedir(), 'Library/Application Support') : env.XDG_CONFIG_HOME ?? join(homedir(), '.config'));
  if (!base || !isAbsolute(base)) throw Error('OS configuration directory is unavailable.');
  const root = join(base, name === 'production' ? contract.productionRoot : `${contract.isolatedRoot}/${id}`);
  return { name, id, root, production: name === 'production', displayName: name === 'production' ? '127Vaults' : name === 'development' ? contract.developmentName : `127Vaults Test ${instance}`,
    nativeHost: `${contract.nativeHost}${name === 'production' ? '' : '.' + id.replaceAll('-', '_')}`,
    environment: { VAULTS_NAMESPACE: name, ...(instance ? { VAULTS_TEST_INSTANCE: instance } : {}) },
    productionProfile:join(base,contract.productionRoot), project: `vaults-${id}`, profile: join(root, contract.desktopDirectory), cliProfile: join(root, 'cli'),
    serverIdentity: join(root, 'server/identity'), serverEnvironment: join(root, 'server/server.env') };
}

export async function assertNamespacePath(namespace, path, { owned = false } = {}) {
  const absolute = resolve(path), rel = relative(namespace.root, absolute);
  if (namespace.production || (!rel && !owned) || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel))
    throw Error('Operation requires a development/test path inside the selected namespace.');
  // Inspect every existing ancestor; lstat also identifies Windows junctions.
  for (let current = absolute;; current = dirname(current)) {
    let info;
    try { info = await lstat(current); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (info?.isSymbolicLink()) throw Error('Namespace paths cannot contain links or junctions.');
    if (dirname(current) === current) break;
  }
  let owner;
  try { owner = (await readFile(join(namespace.root, 'namespace-owner'), 'utf8')).trim(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if ((owned && owner !== namespace.id) || (owner && owner !== namespace.id)) throw Error('Namespace ownership is missing or inconsistent.');
  return absolute;
}

export async function prepareNamespace(namespace) {
  try {await lstat(join(namespace.root,'cleanup.lock'));throw Error('Namespace cleanup is running');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  await assertNamespacePath(namespace, join(namespace.root, 'cli'));
  try {
    await lstat(join(namespace.root,'namespace-owner'));
  } catch(error) {
    if(error.code!=='ENOENT')throw error;
    const entries=await readdir(namespace.root).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
    if(entries.length)throw Error('Existing namespace storage has no ownership marker; review and migrate it explicitly.');
  }
  await mkdir(namespace.root, { recursive: true, mode: 0o700 });
  try { await writeFile(join(namespace.root, 'namespace-owner'), namespace.id, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  await assertNamespacePath(namespace, namespace.root, { owned: true });
}

export async function namespaceProcessLease(namespace) {
  await prepareNamespace(namespace);
  const directory=join(namespace.root,'processes');await assertNamespacePath(namespace,directory,{owned:true});
  await mkdir(directory,{recursive:true,mode:0o700});
  const file=join(directory,`${process.pid}.json`);await assertNamespacePath(namespace,file,{owned:true});
  await writeFile(file,JSON.stringify({namespace:namespace.id,pid:process.pid}),{mode:0o600});
  const release=()=>unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error;});
  try {await lstat(join(namespace.root,'cleanup.lock'));await release();throw Error('Namespace cleanup is running');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  return release;
}

export async function assertServerIdentity(namespace, path) {
  const absolute=await assertNamespacePath(namespace,path,{owned:true});
  const identity=resolve(namespace.serverIdentity);
  const comparable=value=>process.platform==='win32'?value.toLowerCase():value;
  if(comparable(absolute)!==comparable(identity))throw Error('Server identity path differs from this namespace database binding; migrate explicitly.');
}
