const id = location.hash.slice(1);
const status = document.querySelector('#mock-order-status');
const code = document.querySelector('#mock-access-code');
const actions = document.querySelector('#mock-actions');
const details = document.querySelector('#mock-order-details');
const pay = document.querySelector('#mock-pay');
const terms = document.querySelector('#mock-terms');
const price = document.querySelector('#mock-price');
const commercialYears = document.querySelector('#mock-commercial-years');
const commercialUsers = document.querySelector('#mock-commercial-users');
const years = document.querySelector('#mock-years');
const users = document.querySelector('#mock-users');
const acknowledge = document.querySelector('#mock-acknowledge');
let currentPlan = null;
const verify = document.querySelector('#mock-verify');
const emailField = document.querySelector('#mock-email-field');
const emailCode = document.querySelector('#mock-email-code');
const recoverButton = document.createElement('button');
recoverButton.id = 'mock-recover';
recoverButton.type = 'button';
recoverButton.className = 'button primary';
recoverButton.textContent = 'Email recovery code';
document.querySelector('#mock-recover-complete').before(recoverButton);
const bundle = document.querySelector('#mock-bundle');
const installField = document.querySelector('#mock-install-field');
const installId = document.querySelector('#mock-install-id');
const issue = document.querySelector('#mock-issue');
const license = document.querySelector('#mock-license');
const keys = document.querySelector('#mock-keys');
const afterLicense = document.querySelector('#mock-after-license');
const revocation = document.querySelector('#mock-revocation');
const base = `/api/selfhost/mock/orders/${encodeURIComponent(id)}`;
code.value = sessionStorage.getItem(`127v-mock-${id}`) ?? '';

function download(value, name, type = 'application/json') {
  const blob = value instanceof Blob ? value : new Blob([JSON.stringify(value, null, 2) + '\n'], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function request(suffix = '', options = {}) {
  const response = await fetch(`${base}${suffix}`, { ...options,
    headers: { Authorization: `Bearer ${code.value.trim()}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    cache: 'no-store' });
  if (!response.ok) throw Error(response.status === 401 ? 'Access code is invalid.'
    : response.status === 409 ? 'This order is bound to another installation ID.' : `Request failed (${response.status}).`);
  return response;
}
async function refresh() {
  if (!/^[0-9a-f-]{36}$/i.test(id)) { status.textContent = 'The order link is invalid.'; return; }
  try {
    const order = await (await request()).json();
    sessionStorage.setItem(`127v-mock-${id}`, code.value.trim());
    actions.hidden = false;
    currentPlan = order.plan;
    details.textContent = `${order.plan === 'personal' ? 'Personal' : 'Commercial'} self-hosted · ${order.email} · ${order.state.replaceAll('_', ' ')}`
      + (order.commitmentYears ? ` · ${order.commitmentYears} year commitment · ${order.requestedUsers} users` : '');
    const needsEmail = order.state === 'pending_email_verification';
    emailField.hidden = !needsEmail;
    verify.hidden = !needsEmail;
    pay.hidden = order.state !== 'pending_mock_payment';
    terms.hidden = pay.hidden;
    commercialYears.hidden = order.plan !== 'commercial';
    commercialUsers.hidden = order.plan !== 'commercial';
    price.textContent = order.plan === 'personal' ? '$20 per year, five users included. No charge in this simulation.'
      : '$200 per year with a 5 or 10 year commitment. No charge in this simulation.';
    const ready = order.state === 'mock_paid' || order.state === 'license_issued';
    bundle.hidden = !ready;
    installField.hidden = !ready;
    issue.hidden = !ready || order.state === 'license_issued';
    license.hidden = order.state !== 'license_issued';
    keys.hidden = order.state !== 'license_issued';
    afterLicense.hidden = order.state !== 'license_issued';
    revocation.hidden = !order.hasRevocation;
    if (order.installationId) installId.value = order.installationId;
    status.textContent = ready ? 'Simulated checkout complete. Continue with the private server setup.'
      : needsEmail ? 'Enter the code sent to your email address.' : 'Review the simulation, then continue.';
  } catch (error) { actions.hidden = true; status.textContent = error.message; }
}
document.querySelector('#mock-open').addEventListener('click', refresh);
recoverButton.addEventListener('click', async () => {
  try {
    const email = document.querySelector('#mock-recovery-email').value.trim();
    if (!email) throw Error('Enter the email used for this order.');
    const response = await fetch(`${base}/recover`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }) });
    if (!response.ok) throw Error(`Recovery request failed (${response.status}).`);
    status.textContent = 'If the email matches this order, a recovery code has been sent.';
  } catch (error) { status.textContent = error.message; }
});
document.querySelector('#mock-recover-complete').addEventListener('click', async () => {
  try {
    const email = document.querySelector('#mock-recovery-email').value.trim();
    const recoveryCode = document.querySelector('#mock-recovery-code').value.trim();
    if (!/^\d{6}$/.test(recoveryCode)) throw Error('Enter the six-digit recovery code.');
    const response = await fetch(`${base}/recover-complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code: recoveryCode }) });
    if (!response.ok) throw Error(`Recovery failed (${response.status}).`);
    code.value = (await response.json()).accessToken;
    await refresh();
  } catch (error) { status.textContent = error.message; }
});
verify.addEventListener('click', async () => {
  try {
    if (!/^\d{6}$/.test(emailCode.value.trim())) throw Error('Enter the six-digit email code.');
    await request('/verify', { method: 'POST', body: JSON.stringify({ code: emailCode.value.trim() }) });
    await refresh();
  } catch (error) { status.textContent = error.message; }
});
pay.addEventListener('click', async () => {
  try {
    if (!acknowledge.checked) throw Error('Acknowledge that checkout is simulated.');
    const commitmentYears = currentPlan === 'personal' ? 1 : Number(years.value);
    const requestedUsers = currentPlan === 'personal' ? 5 : Number(users.value);
    await request('/pay', { method: 'POST', body: JSON.stringify({ commitmentYears, requestedUsers, termsAcknowledged: true }) });
    await refresh();
  }
  catch (error) { status.textContent = error.message; }
});
bundle.addEventListener('click', async () => {
  try {
    await request('/bundle-ticket', { method: 'POST', body: '{}' });
    location.assign(`${base}/bundle`);
  }
  catch (error) { status.textContent = error.message; }
});
issue.addEventListener('click', async () => {
  try {
    const id = installId.value.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw Error('Enter the installation ID from install identify.');
    await request('/license', { method: 'POST', body: JSON.stringify({ installationId: id }) });
    await refresh();
  } catch (error) { status.textContent = error.message; }
});
license.addEventListener('click', async () => {
  try { download((await (await request('/license')).json()).license, 'license.json'); }
  catch (error) { status.textContent = error.message; }
});
keys.addEventListener('click', async () => {
  try { download(await (await request('/public-keys')).json(), 'issuer-keys.json'); }
  catch (error) { status.textContent = error.message; }
});
document.querySelector('#mock-renew').addEventListener('click', async () => {
  try {
    await request('/renew', { method: 'POST', body: JSON.stringify({ requestId: crypto.randomUUID(), simulatedCheckoutAcknowledged: true }) });
    await refresh();
    status.textContent = 'Simulated renewal issued. Download the new license, install it locally, and restart the server.';
  } catch (error) { status.textContent = error.message; }
});
document.querySelector('#mock-replace').addEventListener('click', async () => {
  try {
    const installationId = document.querySelector('#mock-replace-id').value.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(installationId)) {
      throw Error('Enter the new installation ID from install identify.');
    }
    await request('/replace', { method: 'POST', body: JSON.stringify({ installationId, requestId: crypto.randomUUID(), simulatedReplacementAcknowledged: true }) });
    await refresh();
    status.textContent = 'Replacement test license issued. Download and install it on the new server. Revoke the prior license on the old server if it is accessible.';
  } catch (error) { status.textContent = error.message; }
});
revocation.addEventListener('click', async () => {
  try { download((await (await request('/revocation')).json()).revocation, 'revocation.json'); }
  catch (error) { status.textContent = error.message; }
});
document.querySelector('#mock-erase').addEventListener('click', async () => {
  if (!confirm('Erase this simulated order and its contact information? Existing installed licenses remain in place.')) return;
  try {
    await request('/erase', { method: 'POST', body: '{}' });
    sessionStorage.removeItem(`127v-mock-${id}`);
    code.value = '';
    actions.hidden = true;
    status.textContent = 'Simulated order erased.';
  } catch (error) { status.textContent = error.message; }
});
if (code.value) await refresh();
