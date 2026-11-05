const form = document.querySelector('#waitlist-form');
const status = document.querySelector('#access-status');
const button = form.querySelector('button[type="submit"]');
const details = document.querySelector('#request-details');
const commercialFields = document.querySelector('#commercial-fields');
const comingSoon = document.querySelector('#cloud-coming-soon');
let waitlistOpen = false;
let submitting = false;
let turnstileScript;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve();
  return turnstileScript ??= new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true; script.defer = true;
    const failed = () => { clearTimeout(timeout); script.remove(); reject(Error('Browser verification could not load. Please try again.')); };
    const timeout = setTimeout(failed, 20000);
    script.onload = () => { clearTimeout(timeout); resolve(); }; script.onerror = failed;
    document.head.append(script);
  }).catch(error => { turnstileScript = null; throw error; });
}
async function protectRequest() {
  const response = await fetch('/api/waitlist', { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw Error('Request protection is temporarily unavailable. Please try again later.');
  const protection = await response.json();
  if (!protection.protected) return {};
  status.textContent = 'Checking your browser. Please keep this page open; your request will be sent after a short security wait.';
  const wait = new Promise(resolve => setTimeout(resolve, protection.waitMs));
  await loadTurnstile();
  let widget;
  try {
    const token = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Browser verification expired. Please try again.')), 120000);
      const fail = () => { clearTimeout(timeout); reject(Error('Browser verification failed or expired. Please try again.')); };
      widget = window.turnstile.render('#access-verification', { sitekey: protection.siteKey, action: 'access-request', cData: protection.challengeId, size: matchMedia('(max-width: 480px)').matches ? 'compact' : 'normal',
        callback: token => { clearTimeout(timeout); resolve(token); }, 'error-callback': fail, 'expired-callback': fail });
    });
    const [turnstileToken] = await Promise.all([token, wait]);
    return { challenge: protection.challenge, turnstileToken };
  } finally { if (widget !== undefined) window.turnstile.remove(widget); }
}
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
    contactName: String(data.get('contactName') ?? '').trim(),
    plan: selectedPlan, requestedSeats: Number(data.get('requestedSeats')),
    website: String(data.get('website') ?? ''), consent: data.get('consent') === 'on' };
  let message;
  form.querySelectorAll('input').forEach(input => { input.disabled = true; });
  try {
    const protection = await protectRequest();
    status.textContent = 'Sending your request…';
    const response = await fetch('/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, ...protection }), credentials: 'same-origin' });
    if (response.status === 202) {
      form.reset();
      form.querySelector(`[name="plan"][value="${selectedPlan}"]`).checked = true;
      message = 'Request received. We’ll contact you about availability and next steps.';
    } else message = response.status === 429 ? 'Too many requests. Please try again later.'
      : 'We could not accept your request. Check your details and try again.';
  } catch { message = 'We could not complete verification or send your request. Allow security cookies and browser verification, then try again. Your details are still here.'; }
  form.querySelectorAll('input').forEach(input => { input.disabled = false; });
  submitting = false; updatePlan(); status.textContent = message;
});
