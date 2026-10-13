import test from 'node:test';
import assert from 'node:assert/strict';
import { originOf, matchingLogin, permissionPattern } from '../src/match.mjs';
import { probeFrame, fillFrame } from '../src/fill.mjs';

const origin = 'https://accounts.example.test';
class Input {
  constructor(type, options = {}) {
    this.type = type;
    this.autocomplete = options.autocomplete || '';
    this.name = options.name || '';
    this.id = options.id || '';
    this.placeholder = options.placeholder || '';
    this.form = options.form || null;
    this.labels = [];
    this.value = '';
    this.events = [];
    this.disabled = false;
    this.readOnly = false;
  }
  getAttribute() { return ''; }
  getClientRects() { return [1]; }
  focus() { this.focused = true; }
  dispatchEvent(event) { this.events.push(event.type); }
}
Object.defineProperty(Input.prototype, 'value', { get() { return this._value || ''; }, set(value) { this._value = value; } });

function page(inputs, pageOrigin = origin) {
  globalThis.HTMLInputElement = Input;
  globalThis.Event = class { constructor(type) { this.type = type; } };
  globalThis.getComputedStyle = () => ({ visibility: 'visible', display: 'block' });
  globalThis.location = { origin: pageOrigin };
  globalThis.document = { querySelectorAll: () => inputs, hasFocus: () => true };
}
const credential = { username: 'alice@example.test', password: 'exact-password' };

test('origin matching is exact and HTTPS only', () => {
  assert.equal(originOf('https://vault.local:12781/path'), 'https://vault.local:12781');
  assert.equal(permissionPattern('https://vault.local:12781'), 'https://vault.local/*');
  assert.equal(matchingLogin(`${origin}/sign-in`, `${origin}/session`), true);
  assert.equal(matchingLogin(`${origin}/sign-in`, 'https://evil.accounts.example.test/'), false);
  assert.equal(matchingLogin(`${origin}/sign-in`, 'https://accounts.example.test:444/'), false);
  assert.equal(matchingLogin(`${origin}/sign-in`, 'http://accounts.example.test/'), false);
  assert.equal(originOf('https://alice:password@accounts.example.test/'), null);
  assert.equal(originOf('https://*.example.test/'), null);
});

test('fills a conventional form and fires input/change events', () => {
  const form = {};
  const username = new Input('email', { autocomplete: 'username', form });
  const password = new Input('password', { autocomplete: 'current-password', form });
  page([username, password]);
  assert.deepEqual(probeFrame(origin), { eligible: true, passwordCount: 1, usernameCount: 1, focused: true, frameOrigin: origin });
  assert.deepEqual(fillFrame(origin, credential), { ok: true, username: true, password: true, reason: undefined });
  assert.equal(username.value, credential.username);
  assert.equal(password.value, credential.password);
  assert.deepEqual(username.events, ['input', 'change']);
  assert.deepEqual(password.events, ['input', 'change']);
});

test('fills username and password steps independently', () => {
  const username = new Input('text', { name: 'loginfmt' });
  page([username]);
  assert.equal(fillFrame(origin, credential).username, true);
  assert.equal(username.value, credential.username);
  const password = new Input('password', { name: 'passwd' });
  page([password]);
  const result = fillFrame(origin, credential);
  assert.equal(result.username, false);
  assert.equal(result.password, true);
});

test('fills an open shadow-root form without touching a verification code', () => {
  const form = {};
  const username = new Input('text', { placeholder: 'Email address', form });
  const password = new Input('password', { form });
  const code = new Input('text', { name: 'otp-code', form });
  const host = { shadowRoot: { querySelectorAll: () => [username, password, code] } };
  page([host]);
  assert.equal(probeFrame(origin).eligible, true);
  const result = fillFrame(origin, credential);
  assert.equal(result.username, true);
  assert.equal(result.password, true);
  assert.equal(code.value, '');
});

test('does not fill ambiguous or changed-password forms', () => {
  const first = new Input('password');
  const second = new Input('password');
  page([first, second]);
  assert.equal(probeFrame(origin).eligible, false);
  assert.equal(fillFrame(origin, credential).reason, 'AMBIGUOUS_PASSWORD_FORM');
  assert.equal(first.value, '');
  const newPassword = new Input('password', { autocomplete: 'new-password' });
  page([newPassword]);
  assert.equal(fillFrame(origin, credential).reason, 'NEW_PASSWORD_FORM');
  assert.equal(newPassword.value, '');
});

test('rejects a changed frame origin before touching fields', () => {
  const password = new Input('password');
  page([password], 'https://other.example.test');
  assert.equal(fillFrame(origin, credential).reason, 'ORIGIN_CHANGED');
  assert.equal(password.value, '');
});

test('a signup form cannot receive an existing username beside a new password', () => {
  const form = {};
  const username = new Input('text', { autocomplete: 'username', form });
  const password = new Input('password', { autocomplete: 'new-password', form });
  page([username, password]);
  assert.equal(probeFrame(origin).eligible, false);
  assert.equal(fillFrame(origin, credential).ok, false);
  assert.equal(username.value, '');
  assert.equal(password.value, '');
});
