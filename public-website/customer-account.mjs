const $ = id => document.getElementById(id);
const status = $('customer-status');
async function api(path, body) {
  const response = await fetch(`/api/customer/${path}`, { method: body ? 'POST' : 'GET',
    credentials: 'same-origin', cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) throw Error(response.status === 429 ? 'Too many attempts. Try again later.'
    : response.status === 401 ? 'Sign in again.' : `Request failed (${response.status}).`);
  return response.json();
}
async function refresh() {
  try {
    const account = await api('me');
    $('customer-login').hidden = true;
    $('customer-dashboard').hidden = false;
    $('customer-identity').textContent = account.email;
    const list = $('customer-orders');
    list.replaceChildren();
    for (const order of account.orders) {
      const row = document.createElement('p');
      const button = document.createElement('button');
      button.className = 'button primary';
      button.type = 'button';
      button.textContent = `Open ${order.plan} order from ${order.createdAt.slice(0, 10)}`;
      button.addEventListener('click', async () => {
        try {
          const opened = await api('open-order', { orderId: order.orderId });
          sessionStorage.setItem(`127v-mock-${opened.orderId}`, opened.accessToken);
          location.assign(`mock-checkout.html#${opened.orderId}`);
        } catch (error) { status.textContent = error.message; }
      });
      row.append(button);
      list.append(row);
    }
    if (!account.orders.length) list.textContent = 'No test orders are linked to this email.';
    status.textContent = 'Signed in.';
  } catch {
    $('customer-login').hidden = false;
    $('customer-dashboard').hidden = true;
    status.textContent = 'Enter your email to sign in.';
  }
}
$('customer-start').addEventListener('click', async () => {
  try {
    if (!$('customer-consent').checked) throw Error('Confirm the account data notice first.');
    const email = $('customer-email').value.trim();
    if (!email) throw Error('Enter your email address.');
    await api('start', { email, consent: true });
    status.textContent = 'If delivery succeeds, a six-digit sign-in code will arrive by email.';
  } catch (error) { status.textContent = error.message; }
});
$('customer-complete').addEventListener('click', async () => {
  try {
    const code = $('customer-code').value.trim();
    if (!/^\d{6}$/.test(code)) throw Error('Enter the six-digit code.');
    await api('complete', { email: $('customer-email').value.trim(), code });
    $('customer-code').value = '';
    await refresh();
  } catch (error) { status.textContent = error.message; }
});
$('customer-logout').addEventListener('click', async () => {
  try { await api('logout', {}); await refresh(); }
  catch (error) { status.textContent = error.message; }
});
$('customer-erase').addEventListener('click', async () => {
  if (!confirm('Erase this test customer account and all linked test orders? Installed licenses remain in place.')) return;
  try { await api('erase', { confirm: 'ERASE' }); await refresh(); status.textContent = 'Account and test orders erased.'; }
  catch (error) { status.textContent = error.message; }
});
await refresh();
