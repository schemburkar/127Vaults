// These functions are serialized by chrome.scripting.executeScript and must not
// depend on imports or extension globals inside the injected page.
export function probeFrame(expectedOrigin) {
  if (location.origin !== expectedOrigin) return { eligible: false };
  const collect = root => [...root.querySelectorAll('*')].flatMap(node => [
    ...(node instanceof HTMLInputElement ? [node] : []),
    ...(node.shadowRoot ? collect(node.shadowRoot) : []),
  ]);
  const inputs = collect(document);
  const visible = input => input instanceof HTMLInputElement && !input.disabled && !input.readOnly && input.type !== 'hidden' && input.getClientRects().length > 0 && getComputedStyle(input).visibility !== 'hidden';
  const password = inputs.filter(input => visible(input) && input.type === 'password' && input.autocomplete !== 'new-password');
  const username = inputs.filter(input => visible(input) && ['text','email','tel',''].includes(input.type) && /username|e.?mail|login|user|identifier/i.test([input.autocomplete,input.name,input.id,input.placeholder,input.getAttribute('aria-label'),input.labels && [...input.labels].map(label => label.textContent).join(' ')].join(' ')));
  return { eligible: password.length > 0 || username.length > 0, passwordCount: password.length, usernameCount: username.length, focused: document.hasFocus(), frameOrigin: location.origin };
}

export function fillFrame(expectedOrigin, credential) {
  if (location.origin !== expectedOrigin) return { ok: false, reason: 'ORIGIN_CHANGED' };
  const collect = root => [...root.querySelectorAll('*')].flatMap(node => [
    ...(node instanceof HTMLInputElement ? [node] : []),
    ...(node.shadowRoot ? collect(node.shadowRoot) : []),
  ]);
  const visible = input => input instanceof HTMLInputElement && !input.disabled && !input.readOnly && input.type !== 'hidden' && input.getClientRects().length > 0 && getComputedStyle(input).visibility !== 'hidden' && getComputedStyle(input).display !== 'none';
  const inputs = collect(document).filter(visible);
  const tokens = input => [input.autocomplete,input.name,input.id,input.placeholder,input.getAttribute('aria-label'),input.labels && [...input.labels].map(label => label.textContent).join(' ')].join(' ').toLowerCase();
  const passwords = inputs.filter(input => input.type === 'password' && input.autocomplete !== 'new-password');
  const current = passwords.filter(input => input.autocomplete === 'current-password');
  const password = current.length === 1 ? current[0] : passwords.length === 1 ? passwords[0] : null;
  if (passwords.length > 1 && current.length !== 1) return { ok: false, reason: 'AMBIGUOUS_PASSWORD_FORM' };
  const text = inputs.filter(input => ['text','email','tel',''].includes(input.type) && input.autocomplete !== 'off' && input.autocomplete !== 'one-time-code' && !/otp|one.?time|verification|captcha|search|newsletter|subscribe/.test(tokens(input)));
  const inForm = password ? text.filter(input => input.form === password.form) : text;
  const explicit = inForm.filter(input => /(^|\s)(username|email)(\s|$)/.test(input.autocomplete));
  const named = inForm.filter(input => /user(name)?|e.?mail|login|identifier/.test(tokens(input)) && !/search|newsletter|subscribe/.test(tokens(input)));
  const username = explicit.length === 1 ? explicit[0] : named.length === 1 ? named[0] : (inForm.length === 1 && !/search|newsletter|subscribe/.test(tokens(inForm[0])) && (password || /user|email|login|sign.?in/.test(tokens(inForm[0]))) ? inForm[0] : null);
  if (!username && !password) return { ok: false, reason: 'NO_LOGIN_FIELDS' };
  const set = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    input.focus();
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  let filledUsername = false, filledPassword = false;
  if (username && credential.username) { set(username, credential.username); filledUsername = true; }
  if (password && credential.password) { set(password, credential.password); filledPassword = true; }
  return { ok: filledUsername || filledPassword, username: filledUsername, password: filledPassword, reason: filledUsername || filledPassword ? undefined : 'EMPTY_CREDENTIAL' };
}
