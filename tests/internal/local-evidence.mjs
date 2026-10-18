import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Historical operator evidence is local data, not a source dependency in Git.
export function localEvidence(repository, file) {
  const source = join(repository, file);
  if (existsSync(source)) return source;
  return join(process.env.VAULTS_LOCAL_EVIDENCE_ROOT || join(homedir(), '.127vaults-local', 'evidence'), file);
}
