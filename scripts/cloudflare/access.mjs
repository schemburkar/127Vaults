import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cloudflareApi } from './api.mjs';
import { saveJson } from './config.mjs';

export const mfa = { mfa_disabled: false, allowed_authenticators: ['totp', 'biometrics', 'security_key'], session_duration: '1h' };
export function accessPolicies(config, serviceId) {
  return [
    { name: '127Vaults administrators', decision: 'allow', precedence: 2,
      include: config.sites.adminEmails.map(email => ({ email: { email } })), require: [], exclude: [], mfa_config: mfa },
    { name: '127Vaults release verification', decision: 'non_identity', precedence: 1,
      include: [{ service_token: { token_id: serviceId } }], require: [], exclude: [] },
  ];
}
export async function accessHeaders(config) {
  if (!config.sites || config.sites.adminAccess === false) return {};
  const credentials = JSON.parse(await readFile(join(config.secretsDirectory, 'access-service.json'), 'utf8'));
  if (!credentials.client_id || !credentials.client_secret) throw Error('Access deployment credentials are missing');
  return { 'CF-Access-Client-Id': credentials.client_id, 'CF-Access-Client-Secret': credentials.client_secret };
}
export function assertAccess(config, application, policies, serviceId) {
  if (application.domain !== new URL(config.sites.adminOrigin).hostname || application.type !== 'self_hosted'
    || application.mfa_config?.mfa_disabled !== false || application.mfa_config?.session_duration !== '1h'
    || JSON.stringify([...application.mfa_config.allowed_authenticators ?? []].sort()) !== JSON.stringify([...mfa.allowed_authenticators].sort())) throw Error('Admin Access domain or MFA configuration differs');
  const expected = accessPolicies(config, serviceId);
  if (policies.length !== expected.length) throw Error('Unexpected admin Access policies; review before deployment');
  for (const target of expected) {
    const actual = policies.find(value => value.name === target.name);
    if (!actual || actual.decision !== target.decision
      || JSON.stringify(actual.include) !== JSON.stringify(target.include)
      || actual.require?.length || actual.exclude?.length
      || (target.decision === 'allow' && (actual.mfa_config?.mfa_disabled !== false
        || actual.mfa_config?.session_duration !== '1h'))) throw Error('Admin Access policy differs');
  }
}
export async function configureAccess(config, state, { api, verifyOnly = false } = {}) {
  if (config.sites.adminAccess === false) {
    if (state.accessApplicationId) throw Error('An Access application exists; removing it requires a separate explicit change');
    return { enabled: false, authentication: 'existing operator key and host-only one-hour session', mfaRequired: false };
  }
  api ??= await cloudflareApi(config, { access: true });
  const base = `/accounts/${config.accountId}/access`, hostname = new URL(config.sites.adminOrigin).hostname;
  const apps = await api(`${base}/apps`);
  let app = apps.find(value => value.domain === hostname);
  if (app && state.accessApplicationId !== app.id) throw Error('Existing admin Access application is not owned by this deployment; review it first');
  let service;
  try { service = JSON.parse(await readFile(join(config.secretsDirectory, 'access-service.json'), 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT' || verifyOnly) throw error;
    service = await api(`${base}/service_tokens`, { method: 'POST', body: { name: `${config.workerName}-release-verification`, duration: '8760h' } });
    await writeFile(join(config.secretsDirectory, 'access-service.json'), JSON.stringify(service), { flag: 'wx', mode: 0o600 });
  }
  if (!service.id || !service.client_id || !service.client_secret) throw Error('Invalid deployment service token');
  if (!verifyOnly) {
    const providers = await api(`${base}/identity_providers`);
    let provider = providers.find(value => value.type === 'onetimepin');
    provider ??= await api(`${base}/identity_providers`, { method: 'POST', body: { name: '127Vaults email sign-in', type: 'onetimepin', config: {} } });
    const body = { name: '127Vaults Admin', domain: hostname, type: 'self_hosted', session_duration: '1h',
      allowed_idps: [provider.id], auto_redirect_to_identity: true, app_launcher_visible: false,
      mfa_config: mfa, policies: accessPolicies(config, service.id) };
    app = await api(`${base}/apps${app ? '/' + app.id : ''}`, { method: app ? 'PUT' : 'POST', body });
    state.accessApplicationId = app.id;
    await saveJson(join(config.stateDirectory, 'state.json'), state);
  }
  if (!app) throw Error('Admin Access application is missing');
  const current = await api(`${base}/apps/${app.id}`);
  const policies = await api(`${base}/apps/${app.id}/policies`);
  assertAccess(config, current, policies, service.id);
  return { applicationId: app.id, adminEmails: config.sites.adminEmails, mfaRequired: true, automation: 'scoped service token plus operator authentication' };
}
