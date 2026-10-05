const key = '127vaults-public-theme-v2';
const root = document.documentElement;
const button = document.querySelector('[data-theme-toggle]');
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

let override;
try {
  const saved = localStorage.getItem(key);
  override = saved === 'dark' || saved === 'light' ? saved : null;
} catch {
  override = null;
}

function updateTheme() {
  const theme = override ?? (systemDark.matches ? 'dark' : 'light');
  const next = theme === 'light' ? 'dark' : 'light';
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  const pageColor = getComputedStyle(root).getPropertyValue(theme === 'light' ? '--brand-gold' : '--brand-navy').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', pageColor);
  if (button) {
    const label = override ? 'Use system theme' : `Switch to ${next} theme`;
    button.setAttribute('aria-label', label);
    button.title = label;
  }
}

updateTheme();
systemDark.addEventListener('change', () => { if (!override) updateTheme(); });

button?.addEventListener('click', () => {
  override = override ? null : (root.dataset.theme === 'light' ? 'dark' : 'light');
  try {
    if (override) localStorage.setItem(key, override);
    else localStorage.removeItem(key);
  } catch { /* The current page still updates if storage is unavailable. */ }
  updateTheme();
});
