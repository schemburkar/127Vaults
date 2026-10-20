import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const verifier = existsSync(join(here, 'license-status.mjs')) ? './license-status.mjs' : '../apps/server/src/license-status.mjs';

export async function installLicenseFiles({ runtimeDir, envPath, installationId, licenseSource, keySource, now = new Date() }) {
  const { verifyLicenseFile, licenseStatus } = await import(verifier);
  let keys;
  try { keys = JSON.parse(keySource); } catch { throw Error('Trusted public key file is invalid.'); }
  const accepted = verifyLicenseFile(licenseSource, keys, installationId);
  if (licenseStatus(accepted, now).mode !== 'active') throw Error('License must be active at installation time.');
  const licenseDir = join(runtimeDir, 'licenses');
  await mkdir(licenseDir, { recursive: true, mode: 0o700 });
  const lock = join(licenseDir, '.install-lock');
  await writeFile(lock, '', { flag: 'wx', mode: 0o600 });
  try {
    const recorded = Number((await readFile(join(licenseDir, 'highest-sequence'), 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '0';
      throw error;
    })).trim());
    const existing = (await readdir(licenseDir)).filter(name => /^[1-9]\d*\.json$/.test(name)).map(name => Number(name.slice(0, -5)));
    const prior = Math.max(recorded, 0, ...existing);
    if (!Number.isSafeInteger(prior) || prior < 0 || accepted.sequence <= prior) throw Error('License sequence must be higher than the last installed sequence.');
    const licenseName = `${accepted.sequence}.json`;
    const keyName = `${accepted.sequence}.keys.json`;
    const currentEnv = await readFile(envPath, 'utf8');
    const updated = currentEnv.replace(/^VAULTS_LICENSE_(?:PUBLIC_KEYS_)?FILE=.*\r?\n/gm, '').trimEnd()
      .replace(/^VAULTS_LICENSE_REVOCATION_FILE=.*(?:\r?\n|$)/gm, '').trimEnd()
      + `\nVAULTS_LICENSE_FILE=/run/secrets/runtime/licenses/${licenseName}\nVAULTS_LICENSE_PUBLIC_KEYS_FILE=/run/secrets/runtime/licenses/${keyName}\n`;
    const staged = `${envPath}.license-next`;
    await writeFile(join(licenseDir, licenseName), licenseSource, { flag: 'wx', mode: 0o600 });
    await writeFile(join(licenseDir, keyName), keySource, { flag: 'wx', mode: 0o600 });
    await writeFile(staged, updated, { flag: 'wx', mode: 0o600 });
    try {
      await rename(staged, envPath);
      await writeFile(join(licenseDir, 'highest-sequence'), `${accepted.sequence}\n`, { flag: 'w', mode: 0o600 });
    } finally { await rm(staged, { force: true }); }
    return accepted;
  } finally { await rm(lock, { force: true }); }
}

export async function installRevocationFile({ runtimeDir, envPath, installationId, revocationSource }) {
  const { verifyLicenseFile, verifyLicenseRevocationFile } = await import(verifier);
  const licenseDir = join(runtimeDir, 'licenses');
  const lock = join(licenseDir, '.install-lock');
  await writeFile(lock, '', { flag: 'wx', mode: 0o600 });
  try {
    const content = await readFile(envPath, 'utf8');
    const licenseName = /^VAULTS_LICENSE_FILE=\/run\/secrets\/runtime\/licenses\/([1-9]\d*\.json)$/m.exec(content)?.[1];
    const keysName = /^VAULTS_LICENSE_PUBLIC_KEYS_FILE=\/run\/secrets\/runtime\/licenses\/([1-9]\d*\.keys\.json)$/m.exec(content)?.[1];
    if (!licenseName || !keysName || licenseName.slice(0, -5) !== keysName.slice(0, -10)) throw Error('Install a signed license before revocation.');
    const keySource = await readFile(join(licenseDir, keysName), 'utf8');
    const publicKeys = JSON.parse(keySource);
    const license = verifyLicenseFile(await readFile(join(licenseDir, licenseName), 'utf8'), publicKeys, installationId);
    const revocation = verifyLicenseRevocationFile(revocationSource, publicKeys, installationId, license.licenseId);
    const name = `${license.licenseId}.revocation.json`;
    const staged = `${envPath}.revocation-next`;
    const target = join(licenseDir, name);
    let wrote = false;
    let committed = false;
    try {
      await writeFile(target, revocationSource, { flag: 'wx', mode: 0o600 });
      wrote = true;
      const updated = content.replace(/^VAULTS_LICENSE_REVOCATION_FILE=.*(?:\r?\n|$)/gm, '').trimEnd()
        + `\nVAULTS_LICENSE_REVOCATION_FILE=/run/secrets/runtime/licenses/${name}\n`;
      await writeFile(staged, updated, { flag: 'wx', mode: 0o600 });
      await rename(staged, envPath);
      committed = true;
    } finally {
      await rm(staged, { force: true });
      if (wrote && !committed) await rm(target, { force: true });
    }
    return revocation;
  } finally { await rm(lock, { force: true }); }
}


// Reconnect already backed-up signed records without reinstalling or incrementing them.
export async function restoredLicenseEnvironment({ runtimeDir, installationId }) {
  const directory = join(runtimeDir,'licenses');
  if (!existsSync(directory)) return [];
  const names = await readdir(directory);
  const sequences = names.filter(name => /^[1-9]\d*\.json$/.test(name)).map(name => Number(name.slice(0,-5)));
  const recorded = Number((await readFile(join(directory,'highest-sequence'),'utf8').catch(error => {
    if(error.code === 'ENOENT') return '0'; throw error;
  })).trim());
  const highest = Math.max(recorded,0,...sequences);
  if (!Number.isSafeInteger(highest) || highest < 0 || (highest > 0 && !sequences.includes(highest))) throw Error('Restored highest license sequence is incomplete.');
  if (!highest) return [];
  const keys = JSON.parse(await readFile(join(directory,`${highest}.keys.json`),'utf8'));
  const { verifyLicenseFile, verifyLicenseRevocationFile } = await import(verifier);
  const license = verifyLicenseFile(await readFile(join(directory,`${highest}.json`),'utf8'),keys,installationId);
  if (license.sequence !== highest) throw Error('Restored license sequence does not match its recorded sequence.');
  const result = [`VAULTS_LICENSE_FILE=/run/secrets/runtime/licenses/${highest}.json`,
    `VAULTS_LICENSE_PUBLIC_KEYS_FILE=/run/secrets/runtime/licenses/${highest}.keys.json`];
  const revocationName = `${license.licenseId}.revocation.json`;
  if (existsSync(join(directory,revocationName))) {
    verifyLicenseRevocationFile(await readFile(join(directory,revocationName),'utf8'),keys,installationId,license.licenseId);
    result.push(`VAULTS_LICENSE_REVOCATION_FILE=/run/secrets/runtime/licenses/${revocationName}`);
  }
  return result;
}
