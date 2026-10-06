const form = document.querySelector('#waitlist-form');
const status = document.querySelector('#access-status');
const button = form.querySelector('button[type="submit"]');
const plan = new URLSearchParams(location.search).get('plan');
if (['personal', 'commercial', 'cloud', 'undecided'].includes(plan)) {
  form.querySelector(`[name="plan"][value="${plan}"]`).checked = true;
}

async function checkAvailability() {
  try {
    const response = await fetch('/api/waitlist', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    const state = response.ok ? await response.json() : null;
    if (state?.open === true) {
      button.disabled = false;
      status.textContent = 'The waitlist is open. No payment is collected.';
      return;
    }
  } catch { /* Static previews have no intake API. */ }
  status.textContent = 'The waitlist is not accepting requests from this site yet. Check back for updates.';
}
await checkAvailability();

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (button.disabled || !form.reportValidity()) return;
  button.disabled = true;
  status.textContent = 'Sending your request…';
  const data = new FormData(form);
  const body = { email: String(data.get('email') ?? '').trim(), organization: String(data.get('organization') ?? '').trim(),
    plan: String(data.get('plan') ?? ''), website: String(data.get('website') ?? ''), consent: data.get('consent') === 'on' };
  try {
    const response = await fetch('/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), credentials: 'same-origin' });
    if (response.status === 202) {
      form.reset();
      status.textContent = 'Request received. We’ll contact you when access is available.';
      return;
    }
    status.textContent = response.status === 429 ? 'Too many requests. Please try again later.' : 'We could not accept the request right now. Please try again later.';
  } catch {
    status.textContent = 'We could not reach the waitlist. Please try again later.';
  }
  button.disabled = false;
});
