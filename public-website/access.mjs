import { cloudSeatEstimate } from './cloud-pricing.mjs';

const form = document.querySelector('#waitlist-form');
const status = document.querySelector('#access-status');
const button = form.querySelector('button[type="submit"]');
const plan = new URLSearchParams(location.search).get('plan');
if (['personal', 'commercial', 'cloud', 'undecided'].includes(plan)) {
  form.querySelector(`[name="plan"][value="${plan}"]`).checked = true;
}
const seatField = document.querySelector('#cloud-seat-field');
const seatInput = document.querySelector('#access-seats');
const estimate = document.querySelector('#cloud-seat-estimate');
function updateSeats() {
  const cloud = form.querySelector('[name="plan"]:checked')?.value === 'cloud';
  seatField.hidden = !cloud;
  seatInput.disabled = !cloud;
  seatInput.required = cloud;
  const value = cloudSeatEstimate(Number(seatInput.value));
  estimate.textContent = cloud && value
    ? `$${value.annualUsd.toLocaleString('en-US')} per year, paid upfront each year · $${value.twoYearUsd.toLocaleString('en-US')} over the two-year commitment. Estimate only; no payment today.`
    : 'Enter 1–1,000 planned users to see the estimate.';
}
form.querySelectorAll('[name="plan"]').forEach(input => input.addEventListener('change', updateSeats));
seatInput.addEventListener('input', updateSeats);
updateSeats();

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
    plan: String(data.get('plan') ?? ''), requestedSeats: data.get('plan') === 'cloud' ? Number(data.get('requestedSeats')) : null,
    website: String(data.get('website') ?? ''), consent: data.get('consent') === 'on' };
  try {
    const response = await fetch('/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), credentials: 'same-origin' });
    if (response.status === 202) {
      form.reset();
      updateSeats();
      status.textContent = 'Request received. We’ll contact you when access is available.';
      return;
    }
    status.textContent = response.status === 429 ? 'Too many requests. Please try again later.' : 'We could not accept the request right now. Please try again later.';
  } catch {
    status.textContent = 'We could not reach the waitlist. Please try again later.';
  }
  button.disabled = false;
});
