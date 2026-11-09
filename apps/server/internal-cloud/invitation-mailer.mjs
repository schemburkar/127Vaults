import { randomUUID } from 'node:crypto';
import { lstat, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { readSecretFile } from '../src/runtime-config.mjs';
import { SmtpMailer } from '../src/smtp.mjs';

export async function cloudInvitationMailer(env) {
  const mode = env.VAULTS_CLOUD_INVITATION_MAIL ?? 'disabled';
  if (mode === 'disabled') return undefined;
  if (mode === 'smtp') {
    return new SmtpMailer({ host: env.SMTP_HOST, port: Number(env.SMTP_PORT ?? 465), username: env.SMTP_USERNAME,
      password: readSecretFile(env.SMTP_PASSWORD_FILE, 'Cloud SMTP password', /^[\x21-\x7e]{1,512}$/),
      from: env.SMTP_FROM, installationLabel: '127Vaults-Cloud' });
  }
  if (mode !== 'capture') throw new Error('Unknown Cloud invitation mail mode.');
  const directory = env.VAULTS_CLOUD_MAIL_CAPTURE_DIR;
  if ((env.VAULTS_CLOUD_BIND ?? '127.0.0.1') !== '127.0.0.1' || !directory || !isAbsolute(directory)) {
    throw new Error('Cloud mail capture requires a loopback listener and an absolute capture directory.');
  }
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (process.platform !== 'win32' && (info.mode & 0o077) !== 0)) {
    throw new Error('Cloud mail capture requires a private directory.');
  }
  return {
    async sendCode({ to, code, expiresMinutes }) {
      await writeFile(join(directory, `${randomUUID()}.json`), JSON.stringify({ to, code,
        expiresAt: new Date(Date.now() + expiresMinutes * 60_000).toISOString() }), { mode: 0o600, flag: 'wx' });
    }
  };
}
