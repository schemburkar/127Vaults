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
  root.querySelector('.setup-navigation').hidden = false;
  const save = () => { try { storage?.setItem(storageKey, JSON.stringify(progress)); } catch { /* Continue without storage. */ } };
  const render = (focus = false) => {
    panels.forEach((panel, index) => {
      panel.hidden = index !== progress.step;
      panel.querySelector('[data-complete]').checked = progress.completed.includes(stages[index]);
    });
    root.querySelector('#setup-progress').textContent = `Step ${progress.step + 1} of ${stages.length}`;
    back.disabled = progress.step === 0;
    next.disabled = !progress.completed.includes(stages[progress.step]);
    next.textContent = progress.step === stages.length - 1 ? 'Finish' : 'Next';
    if (focus) panels[progress.step].querySelector('h2').focus();
  };
  panels.forEach((panel, index) => panel.querySelector('[data-complete]').addEventListener('change', event => {
    progress.completed = progress.completed.filter(id => id !== stages[index]);
    if (event.target.checked) progress.completed.push(stages[index]);
    root.querySelector('#setup-finished').hidden = true;
    save(); render();
  }));
  back.addEventListener('click', () => { if (progress.step > 0) { progress.step--; save(); render(true); } });
  next.addEventListener('click', () => {
    if (!progress.completed.includes(stages[progress.step])) return;
    if (progress.step < stages.length - 1) { progress.step++; save(); render(true); }
    else root.querySelector('#setup-finished').hidden = false;
  });
  root.querySelector('#setup-reset').addEventListener('click', () => {
    progress = readProgress(null); root.querySelector('#setup-finished').hidden = true; save(); render(true);
  });
  render();
}

if (typeof document !== 'undefined') {
  let storage; try { storage = window.localStorage; } catch { /* Private browsing may disable it. */ }
  mountChecklist(document, storage);
}
