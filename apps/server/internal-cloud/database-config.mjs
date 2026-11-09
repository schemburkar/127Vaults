import { readFile } from 'node:fs/promises';
import { runtimeDatabaseConfig } from '../src/runtime-config.mjs';

export async function cloudDatabaseConfig(env) {
  const config = runtimeDatabaseConfig(env);
  if (env.VAULTS_CLOUD_DATABASE_CA_FILE) {
    config.ssl = { ca: await readFile(env.VAULTS_CLOUD_DATABASE_CA_FILE, 'utf8'), rejectUnauthorized: true };
  }
  return config;
}
