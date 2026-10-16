const form = document.querySelector('#waitlist-form');
const status = document.querySelector('#access-status');
const button = form.querySelector('button[type="submit"]');
const details = document.querySelector('#request-details');
const commercialFields = document.querySelector('#commercial-fields');
const comingSoon = document.querySelector('#cloud-coming-soon');
let waitlistOpen = false;
let submitting = false;
const plan = new URLSearchParams(location.search).get('plan');
if (['personal', 'commercial', 'cloud'].includes(plan)) form.querySelector(`[name="plan"][value="${plan}"]`).checked = true;
function updatePlan() {
  const selected = form.querySelector('[name="plan"]:checked')?.value;
  const cloud = selected === 'cloud', commercial = selected === 'commercial';
  comingSoon.hidden = !cloud;
  details.hidden = cloud; details.disabled = cloud;
  commercialFields.hidden = !commercial; commercialFields.disabled = !commercial;
  for (const field of commercialFields.querySelectorAll('input')) field.required = commercial;
  button.disabled = cloud || !waitlistOpen || submitting;
  status.textContent = waitlistOpen ? '' : 'Requests are currently unavailable. Please check back soon.';
}
form.querySelectorAll('[name="plan"]').forEach(input => input.addEventListener('change', updatePlan));
updatePlan();
try {
  const response = await fetch('/api/waitlist', { headers: { Accept: 'application/json' }, cache: 'no-store' });
  waitlistOpen = response.ok && (await response.json()).open === true;
} catch { waitlistOpen = false; }
updatePlan();
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (button.disabled || details.disabled || !form.reportValidity()) return;
  submitting = true; button.disabled = true; status.textContent = 'Sending your request…';
  const data = new FormData(form), selectedPlan = String(data.get('plan') ?? '');
  const body = { email: String(data.get('email') ?? '').trim(),
    organization: selectedPlan === 'commercial' ? String(data.get('organization') ?? '').trim() : '',
    contactName: selectedPlan === 'commercial' ? String(data.get('contactName') ?? '').trim() : '',
    plan: selectedPlan, requestedSeats: Number(data.get('requestedSeats')),
    website: String(data.get('website') ?? ''), consent: data.get('consent') === 'on' };
  let message;
  try {
    const response = await fetch('/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), credentials: 'same-origin' });
    if (response.status === 202) {
      form.reset();
      form.querySelector(`[name="plan"][value="${selectedPlan}"]`).checked = true;
      message = 'Request received. We’ll contact you about your trial.';
    } else message = response.status === 429 ? 'Too many requests. Please try again later.'
      : 'We could not accept your request. Check your details and try again.';
  } catch { message = 'We could not send your request. Please try again.'; }
  submitting = false; updatePlan(); status.textContent = message;
});
