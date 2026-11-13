export async function portalApi(path, value) {
  const response = await fetch(`/api/customer/${path}`, { method: value === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: value === undefined ? {} : { 'Content-Type': 'application/json' }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  if (!response.ok) {
    const value = await response.json().catch(() => ({}));
    const error = new Error(value.error === 'recent_sign_in_required' ? 'Sign in again with a passkey or email code to manage passkeys.'
      : value.error === 'invalid_passkey_name' ? 'Enter a passkey name between 1 and 80 characters.'
      : value.error === 'passkey_already_registered' ? 'That passkey is already registered.'
      : value.error === 'passkey_limit' ? 'You can register up to 20 passkeys. Remove one to add another.'
      : path.startsWith('passkeys') && response.status === 403 ? 'The passkey could not be verified. Try again or use an email code.'
      : response.status === 403 ? 'The code is invalid, expired, or already used. Request another code.'
      : response.status === 429 ? 'Too many attempts. Please try again later.' : response.status === 401 ? 'Sign in to the customer portal or reopen your invitation.' : 'Customer sign-in is temporarily unavailable.');
    if(typeof document!=='undefined'&&response.status===401&&(path==='me'||path.startsWith('passkeys')))document.dispatchEvent(new Event('manage-session-ended'));
    error.status = response.status; throw error;
  }
  return response.json();
}
export const establishInvitationSession = (requestId, token) => portalApi('invitation', { requestId, token });
export function parseInvitation(value, origin = location.origin) {
  const url = new URL(value);
  if (url.origin !== origin || !['/trial', '/trial.html', '/billing', '/billing.html'].includes(url.pathname)) throw Error('Use the original invitation link for this customer portal.');
  const match = /^([a-f0-9]{64})\.([A-Za-z0-9_-]{43})$/.exec(url.hash.slice(1));
  if (!match) throw Error('The invitation link is incomplete. Copy the complete original link.');
  return { requestId: match[1], token: match[2] };
}
