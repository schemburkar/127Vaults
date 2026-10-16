import { cloudSeatEstimate } from './cloud-pricing.mjs';

const form = document.querySelector('#waitlist-form');
const status = document.querySelector('#access-status');
const button = form.querySelector('button[type="submit"]');
let waitlistOpen = false;
let mockSelfHostOpen = false;
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
  updateAvailability();
}
function updateAvailability() {
  const selected = form.querySelector('[name="plan"]:checked')?.value;
  const mock = mockSelfHostOpen && ['personal', 'commercial'].includes(selected);
  button.disabled = !(mock || waitlistOpen);
  button.textContent = mock ? 'Continue to simulated checkout' : 'Request access';
  status.textContent = mock
    ? 'Supervised test only: checkout is simulated and collects no payment.'
    : waitlistOpen ? 'Access requests are open. We review requests for private trials; no payment is collected.'
      : 'The waitlist is not accepting requests from this site yet. Check back for updates.';
}
form.querySelectorAll('[name="plan"]').forEach(input => input.addEventListener('change', updateSeats));
seatInput.addEventListener('input', updateSeats);
updateSeats();

async function checkAvailability() {
  const check = async path => {
    try {
      const response = await fetch(path, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      return response.ok && (await response.json()).open === true;
    } catch { return false; }
  };
  [waitlistOpen, mockSelfHostOpen] = await Promise.all([check('/api/waitlist'), check('/api/selfhost/mock')]);
  updateAvailability();
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
    const mock = mockSelfHostOpen && ['personal', 'commercial'].includes(body.plan);
    const response = await fetch(mock ? '/api/selfhost/mock/orders' : '/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mock ? { email: body.email, organization: body.organization, plan: body.plan,
        website: body.website, consent: body.consent } : body), credentials: 'same-origin' });
    if (mock && response.status === 201) {
      const order = await response.json();
      sessionStorage.setItem(`127v-mock-${order.orderId}`, order.accessToken);
      location.assign(`mock-checkout.html#${order.orderId}`);
      return;
    }
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
  button.disabled = !(waitlistOpen || (mockSelfHostOpen && ['personal', 'commercial'].includes(body.plan)));
});
