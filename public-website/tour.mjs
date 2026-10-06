const items = {
  personal: [
    { title: 'Atlas Mail', site: 'atlas.example', user: 'alex@atlas.example', icon: 'A' },
    { title: 'Northstar Notes', site: 'notes.example', user: 'alex@notes.example', icon: 'N' },
    { title: 'Studio Account', site: 'studio.example', user: 'alex@studio.example', icon: 'S' },
  ],
  shared: [
    { title: 'Portal Workspace', site: 'portal.example', user: 'alex@portal.example', icon: 'P' },
    { title: 'Team Calendar', site: 'calendar.example', user: 'team@calendar.example', icon: 'T' },
  ],
};
let vault = 'personal';
let selected = items.personal[0];
const search = document.querySelector('#demo-search');
const list = document.querySelector('[data-item-list]');
const reveal = document.querySelector('[data-reveal]');
const samplePassword = 'VaultPassphrase!27';

function renderDetail() {
  document.querySelector('[data-detail-title]').textContent = selected.title;
  document.querySelector('[data-detail-icon]').textContent = selected.icon;
  document.querySelector('[data-detail-vault]').textContent = `${vault === 'personal' ? 'Personal' : 'Work'} vault`;
  document.querySelector('[data-detail-site]').textContent = selected.site;
  document.querySelector('[data-detail-user]').textContent = selected.user;
  reveal.setAttribute('aria-pressed', 'false');
  reveal.textContent = 'Reveal';
  document.querySelector('[data-detail-password]').textContent = '••••••••••••';
}
function renderList() {
  const query = search.value.trim().toLowerCase();
  const visible = items[vault].filter((item) => `${item.title} ${item.site}`.toLowerCase().includes(query));
  list.replaceChildren();
  visible.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `demo-item${selected === item ? ' selected' : ''}`;
    const icon = document.createElement('span');
    icon.className = 'demo-item-icon';
    icon.textContent = item.icon;
    const copy = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = item.title;
    const site = document.createElement('small');
    site.textContent = item.site;
    copy.append(title, site);
    button.append(icon, copy);
    button.addEventListener('click', () => { selected = item; renderDetail(); renderList(); });
    list.append(button);
  });
  document.querySelector('[data-result-count]').textContent = `${visible.length} item${visible.length === 1 ? '' : 's'}`;
  document.querySelector('[data-empty]').hidden = visible.length !== 0;
}
document.querySelectorAll('[data-vault]').forEach((button) => button.addEventListener('click', () => {
  vault = button.dataset.vault;
  selected = items[vault][0];
  search.value = '';
  document.querySelectorAll('[data-vault]').forEach((other) => other.classList.toggle('active', other === button));
  document.querySelector('[data-vault-title]').textContent = `${vault === 'personal' ? 'Personal' : 'Work'} vault`;
  renderDetail();
  renderList();
}));
search?.addEventListener('input', renderList);
reveal?.addEventListener('click', () => {
  const shown = reveal.getAttribute('aria-pressed') !== 'true';
  reveal.setAttribute('aria-pressed', String(shown));
  reveal.textContent = shown ? 'Hide' : 'Reveal';
  document.querySelector('[data-detail-password]').textContent = shown ? samplePassword : '••••••••••••';
});
if (list) renderList();

const fillButton = document.querySelector('[data-demo-fill]');
const extensionSearch = document.querySelector('.extension-search');
extensionSearch?.addEventListener('input', () => {
  const matches = 'Portal Workspace portal.example'.toLowerCase().includes(extensionSearch.value.trim().toLowerCase());
  fillButton.hidden = !matches;
  document.querySelector('[data-fill-message]').textContent = matches
    ? '1 matching login from Desktop. Choose one to fill.'
    : 'No login from Desktop matches this search.';
});
fillButton?.addEventListener('click', () => {
  const fields = document.querySelectorAll('.sample-signin input');
  fields[0].value = 'alex@portal.example';
  fields[1].value = 'VaultPassphrase!27';
  document.querySelector('[data-fill-message]').textContent = 'Filled username and password. Review the form and submit it yourself.';
});

const examples = {
  vaults: "$ 127vaults vault list\n[\n  {\n    \"code\": \"V-91E900D1C9\",\n    \"name\": \"Personal\",\n    \"retired\": false,\n    \"retirementChoice\": null,\n    \"vaultId\": \"3f55b208-1d78-4fd1-849c-7622f230c19c\"\n  },\n  {\n    \"code\": \"V-95840506C7\",\n    \"name\": \"Work\",\n    \"retired\": false,\n    \"retirementChoice\": null,\n    \"vaultId\": \"7bc57a18-f9ba-4dab-8e22-0cc390c5c125\"\n  }\n]",
  items: "$ 127vaults item list --vault Personal\n[\n  {\n    \"code\": \"I-187AADBE55\",\n    \"itemId\": \"2511ef64-52e2-4557-812d-4ad108b8ec33\",\n    \"title\": \"Atlas Mail\",\n    \"website\": \"atlas.example\"\n  },\n  {\n    \"code\": \"I-008310DDDE\",\n    \"itemId\": \"71170749-aa67-4e63-8bfd-89955279a3f1\",\n    \"title\": \"Northstar Notes\",\n    \"website\": \"notes.example\"\n  }\n]",
  status: "$ 127vaults status\nconfigured: yes\nauthenticated: yes\nunlocked: yes\nsecrets: [redacted]",
};
const output = document.querySelector('[data-cli-output]');
if (output) output.textContent = examples.vaults;
document.querySelectorAll('[data-cli]').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('[data-cli]').forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
  output.textContent = examples[button.dataset.cli];
}));
