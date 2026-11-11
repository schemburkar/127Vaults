import { portalApi } from './portal-client.mjs';
const $ = id => document.getElementById(id);
const encode = value => btoa(String.fromCharCode(...new Uint8Array(value))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const decode = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), character => character.charCodeAt(0));
function serialize(credential) {
  const response = credential.response;
  return { id: credential.id, rawId: encode(credential.rawId), type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults(), authenticatorAttachment: credential.authenticatorAttachment,
    response: { clientDataJSON: encode(response.clientDataJSON),
      ...(response.attestationObject ? { attestationObject: encode(response.attestationObject), transports: response.getTransports?.() ?? [] }
        : { authenticatorData: encode(response.authenticatorData), signature: encode(response.signature),
          userHandle: response.userHandle ? encode(response.userHandle) : null }) } };
}
async function authenticate() {
  const { challengeId, options } = await portalApi('passkeys/login/options', {});
  const credential = await navigator.credentials.get({ publicKey: { ...options, challenge: decode(options.challenge) } });
  if (!credential) throw Error('Passkey sign-in was cancelled.');
  await portalApi('passkeys/login/verify', { challengeId, credential: serialize(credential) });
}
async function run(work) {
  const controls = [...document.querySelectorAll('[data-passkey-control]')];
  controls.forEach(button => { button.disabled = true; });
  try { $('passkey-status').textContent = ''; await work(); }
  catch (error) {
    $('passkey-status').textContent = ['NotAllowedError', 'AbortError'].includes(error.name)
      ? 'Passkey request cancelled. You can try again or use an email code.' : error.message;
  } finally { controls.forEach(button => { button.disabled = false; }); }
}
export async function renderPasskeys(emailSession) {
  $('passkey-settings').hidden = !emailSession;
  if (!emailSession) return;
  const result = await portalApi('passkeys');
  $('passkey-recent').hidden = result.recentSignIn;
  $('passkey-add').hidden = !result.recentSignIn || !window.PublicKeyCredential || !window.isSecureContext;
  const list = $('passkey-list');
  list.replaceChildren();
  for (const passkey of result.passkeys) {
    const row = document.createElement('li');
    const form = document.createElement('form');
    form.className = 'portal-passkey-row';
    const label = document.createElement('label');
    label.className = 'access-field';
    label.textContent = 'Passkey name';
    const name = document.createElement('input');
    name.value = passkey.name; name.maxLength = 80; name.required = true;
    label.append(name);
    const dates = document.createElement('p');
    dates.textContent = `Added ${new Date(passkey.createdAt).toLocaleDateString()} · ${passkey.lastUsedAt
      ? 'Last used ' + new Date(passkey.lastUsedAt).toLocaleString() : 'Not used yet'}${passkey.current ? ' · This sign-in' : ''}`;
    const save = document.createElement('button');
    save.type = 'submit'; save.className = 'button secondary'; save.textContent = 'Save name'; save.dataset.passkeyControl = '';
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'button secondary'; remove.textContent = 'Remove'; remove.dataset.passkeyControl = '';
    save.hidden = remove.hidden = !result.recentSignIn;
    form.addEventListener('submit', event => { event.preventDefault(); run(async () => {
      await portalApi('passkeys/rename', { id: passkey.id, name: name.value }); await renderPasskeys(true);
    }); });
    remove.addEventListener('click', () => run(async () => {
      if (!confirm(`Remove “${passkey.name}”? You can still sign in with an email code.`)) return;
      await portalApi('passkeys/remove', { id: passkey.id });
      if (passkey.current) location.reload();
      else await renderPasskeys(true);
    }));
    form.append(label, save, remove);
    row.append(form, dates); list.append(row);
  }
  if (!result.passkeys.length) list.textContent = 'Add a passkey to sign in with your fingerprint, face, device PIN, or security key.';
}
export function setupPasskeys(onSignedIn) {
  const available = Boolean(window.PublicKeyCredential && navigator.credentials && window.isSecureContext);
  $('passkey-login').hidden = !available;
  $('passkey-add').hidden = !available;
  $('passkey-login').addEventListener('click', () => run(async () => { await authenticate(); await onSignedIn(); }));
  $('passkey-reauth').addEventListener('click', () => run(async () => { await authenticate(); await onSignedIn(); }));
  $('passkey-add').addEventListener('submit', event => {
    event.preventDefault();
    run(async () => {
      const { challengeId, options } = await portalApi('passkeys/register/options', { name: $('passkey-name').value });
      const credential = await navigator.credentials.create({ publicKey: { ...options,
        challenge: decode(options.challenge), user: { ...options.user, id: decode(options.user.id) },
        excludeCredentials: options.excludeCredentials.map(value => ({ ...value, id: decode(value.id) })) } });
      if (!credential) throw Error('Passkey registration was cancelled.');
      await portalApi('passkeys/register/verify', { challengeId, credential: serialize(credential) });
      $('passkey-name').value = '';
      await renderPasskeys(true);
      $('passkey-status').textContent = 'Passkey added. You can use it next time you sign in.';
    });
  });
}
