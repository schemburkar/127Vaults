import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// One filesystem is the authority for one intake process. The lock also makes
// concurrent requests in that process and after a restart use the same budget.
export function createDurableLimit({ directory, now = () => Date.now() }) {
  if (!directory) throw Error('rate-limit directory is required');
  return async function allow(scope, subject, limit, windowMs) {
    const id = createHash('sha256').update(`${scope}\0${subject}`).digest('hex');
    const path = join(directory, `${id}.json`);
    const lock = `${path}.lock`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    let acquired = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      try { await mkdir(lock); acquired = true; break; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const age = await stat(lock).then(info => now() - info.mtimeMs).catch(() => 0);
        if (age > 60000) await rm(lock, { recursive: true, force: true });
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    if (!acquired) throw Error('rate limit is busy');
    try {
      const previous = JSON.parse(await readFile(path, 'utf8').catch(error => {
        if (error.code === 'ENOENT') return '[]';
        throw error;
      }));
      if (!Array.isArray(previous)) throw Error('invalid rate-limit record');
      const at = now();
      const recent = previous.filter(time => Number.isSafeInteger(time) && time <= at && at - time < windowMs);
      if (recent.length >= limit) return false;
      const temporary = join(directory, `${id}.${randomUUID()}.tmp`);
      await writeFile(temporary, JSON.stringify([...recent, at]), { flag: 'wx', mode: 0o600 });
      await rename(temporary, path);
      return true;
    } finally { await rm(lock, { recursive: true, force: true }); }
  };
}

export async function withFileLock(lock, work) {
  let acquired = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { await mkdir(lock); acquired = true; break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const age = await stat(lock).then(info => Date.now() - info.mtimeMs).catch(() => 0);
      if (age > 60000) await rm(lock, { recursive: true, force: true });
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  if (!acquired) throw Error('record is busy');
  try { return await work(); }
  finally { await rm(lock, { recursive: true, force: true }); }
}

export async function pruneDurableLimits(directory, now = Date.now()) {
  let removed = 0;
  for (const name of await readdir(directory).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  })) {
    if (!/^[0-9a-f]{64}\.json$/.test(name)) continue;
    const path = join(directory, name);
    const info = await stat(path);
    if (now - info.mtimeMs > 48 * 3600000) { await unlink(path); removed++; }
  }
  return removed;
}
