import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const reasons = {
  activeTab: 'Fill only the website selected by the user.',
  idle: 'Lock vault sources when the operating system locks.',
  nativeMessaging: 'Connect to the locally installed Desktop or CLI host.',
  scripting: 'Inspect and fill the selected login form after user action.',
  storage: 'Remember non-secret source preferences and browser permissions.',
};
// Preparation only. Store accounts, review, published IDs and signing are external steps.
export async function prepareStoreReview(directory) {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  if (manifest.manifest_version !== 3 || !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(manifest.version) ||
      manifest.host_permissions?.length || manifest.externally_connectable || manifest.key ||
      manifest.permissions.some(permission => !Object.hasOwn(reasons, permission)) ||
      manifest.optional_host_permissions?.some(pattern => pattern !== 'https://*/*')) throw Error('Extension permissions require a new distribution review.');
  for (const path of ['popup.html', manifest.background.service_worker, ...Object.values(manifest.icons)]) {
    if (typeof path !== 'string' || path.includes('..') || path.startsWith('/') || path.includes(':')) throw Error('Invalid extension asset path');
    await access(join(directory, path));
  }
  const review = {
    version: manifest.version, name: manifest.name, distribution: 'prepared-not-published',
    singlePurpose: 'User-selected password filling and passkey use from their own vault.',
    requiredPermissions: Object.fromEntries(manifest.permissions.map(permission => [permission, reasons[permission]])),
    optionalPermissions: {'https://*/*': 'Requested explicitly for web vault access or passkey support. Password filling uses user-selected tabs.'},
    dataHandling: 'Vault credentials stay in the selected vault client. Selected values are delivered to the user-approved page. No analytics or advertising endpoints.',
    operatorSteps: ['Review store privacy disclosures against this source version.', 'Upload the coordinated extension archive to the chosen browser store.', 'Record the real published extension ID and register that ID in each local native host.', 'Verify install, unlock, fill, lock and removal using the store-signed build before advertising its link.'],
  };
  await writeFile(join(directory, 'store-review.json'), JSON.stringify(review, null, 2) + '\n');
  return review;
}
