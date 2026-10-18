export const stages = ['prerequisites', 'packages', 'server', 'license', 'owner', 'clients', 'verify'];
const storageKey = '127vaults.setup-checklist.v1';
export function readProgress(source) {
  try {
    const value = JSON.parse(source);
    if (value?.version !== 1 || !Number.isInteger(value.step) || value.step < 0 || value.step >= stages.length
      || !Array.isArray(value.completed) || value.completed.some(id => !stages.includes(id))) throw Error();
    return { version: 1, step: value.step, completed: [...new Set(value.completed)] };
  } catch { return { version: 1, step: 0, completed: [] }; }
}

export function mountChecklist(document, storage) {
  const root = document.getElementById('setup-checklist');
  if (!root) return;
  let saved; try { saved = storage?.getItem(storageKey); } catch { /* Resume is optional. */ }
  let progress = readProgress(saved);
  const panels = [...root.querySelectorAll('[data-setup-step]')];
  const back = root.querySelector('#setup-back'), next = root.querySelector('#setup-next');
  const links = [...root.querySelectorAll('[data-step-link]')];
  root.querySelector('.setup-navigation').hidden = false;
  const save = () => { try { storage?.setItem(storageKey, JSON.stringify(progress)); } catch { /* Continue without storage. */ } };
  const render = (focus = false) => {
    panels.forEach((panel, index) => {
      panel.hidden = index !== progress.step;
    });
    root.querySelector('#setup-progress').textContent = `Step ${progress.step + 1} of ${stages.length}`;
    back.disabled = progress.step === 0;
    next.disabled = false;
    links.forEach(link => {
      if (link.dataset.stepLink === stages[progress.step]) link.setAttribute('aria-current', 'step');
      else link.removeAttribute('aria-current');
    });
    next.textContent = progress.step === stages.length - 1 ? 'Finish' : 'Next';
    if (focus) panels[progress.step].querySelector('h2').focus();
  };
  links.forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    progress.step = stages.indexOf(link.dataset.stepLink);
    root.querySelector('#setup-finished').hidden = true;
    save(); render(true);
  }));
  root.querySelectorAll('pre').forEach(block => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'setup-copy'; button.textContent = 'Copy';
    button.setAttribute('aria-label', 'Copy command');
    button.addEventListener('click', async () => {
      try {
        await document.defaultView.navigator.clipboard.writeText(block.querySelector('code').textContent);
        button.textContent = 'Copied';
      } catch { button.textContent = 'Select and copy'; }
    });
    block.append(button);
  });
  back.addEventListener('click', () => { if (progress.step > 0) { progress.step--; save(); render(true); } });
  next.addEventListener('click', () => {
    root.querySelector('#setup-finished').hidden = true;
    if (progress.step < stages.length - 1) { progress.step++; save(); render(true); }
    else root.querySelector('#setup-finished').hidden = false;
  });
  root.querySelector('#setup-reset').addEventListener('click', () => {
    progress = readProgress(null); root.querySelector('#setup-finished').hidden = true; save(); render(true);
  });
  const initial = stages.indexOf(document.defaultView?.location.hash.slice(1));
  if (initial >= 0) progress.step = initial;
  render();
}

if (typeof document !== 'undefined') {
  let storage; try { storage = window.localStorage; } catch { /* Private browsing may disable it. */ }
  mountChecklist(document, storage);
}
