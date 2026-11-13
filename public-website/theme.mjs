const key = '127vaults-public-theme-v2';
const root = document.documentElement;
const button = document.querySelector('[data-theme-toggle]');

let override;
try {
  const saved = localStorage.getItem(key);
  override = saved === 'dark' || saved === 'light' ? saved : null;
} catch {
  override = null;
}

function updateTheme() {
  const theme = override ?? 'dark';
  const next = theme === 'light' ? 'dark' : 'light';
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  const pageColor = getComputedStyle(root).getPropertyValue(theme === 'light' ? '--brand-gold' : '--brand-navy').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', pageColor);
  if (button) {
    const label = `Switch to ${next} theme`;
    button.setAttribute('aria-label', label);
    button.title = label;
  }
}

updateTheme();

button?.addEventListener('click', () => {
  override = root.dataset.theme === 'light' ? 'dark' : 'light';
  try {
    localStorage.setItem(key, override);
  } catch { /* The current page still updates if storage is unavailable. */ }
  updateTheme();
});

const subscriptionOptions = document.querySelector('.subscribe-options');
document.addEventListener('click', event => {
  if (subscriptionOptions && !subscriptionOptions.parentElement.contains(event.target)) subscriptionOptions.open = false;
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && subscriptionOptions?.open) {
    subscriptionOptions.open = false;
    subscriptionOptions.querySelector('summary').focus();
  }
});
