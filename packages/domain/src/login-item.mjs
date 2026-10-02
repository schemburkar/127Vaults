// Client plaintext only. This is neither a server DTO nor a cryptographic format.
const limits = Object.freeze({ title: 512, username: 4096, password: 16384, url: 4096, customValue: 16384 });
function record(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).some(key => !keys.includes(key))) throw new TypeError('Invalid login item shape.');
}
function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && value.trim().length === 0) ||
      !value.isWellFormed()) throw new TypeError('Invalid login item text.');
  return value; // Preserve exact password/username code points; never normalize.
}
export function createLoginItem(input) {
  record(input, ['title', 'username', 'password', 'urls', 'customFields']);
  if (!Array.isArray(input.urls) || input.urls.length > 20 ||
      !Array.isArray(input.customFields) || input.customFields.length > 50) throw new TypeError('Invalid login item collections.');
  const urls = Array.from(input.urls, value => {
    text(value, limits.url, true);
    let url;
    try { url = new URL(value); } catch { throw new TypeError('Invalid login URL.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        value !== value.trim() || /[\u0000-\u0020\u007f]/.test(value)) throw new TypeError('Invalid login URL.');
    return value;
  });
  const customFields = Array.from(input.customFields, field => {
    record(field, ['name', 'value', 'concealed']);
    if (typeof field.concealed !== 'boolean') throw new TypeError('Invalid custom-field visibility.');
    return Object.freeze({ name: text(field.name, 128, true), value: text(field.value, limits.customValue), concealed: field.concealed });
  });
  return Object.freeze({ title: text(input.title, limits.title, true),
    username: text(input.username, limits.username), password: text(input.password, limits.password),
    urls: Object.freeze(urls), customFields: Object.freeze(customFields) });
}

export function createLoginIndex(input) {
  const item = createLoginItem(input);
  // Domain-only display metadata: never URL paths, queries, usernames or secrets.
  // Not an autofill authorization policy or a public server index.
  return Object.freeze({ title: item.title,
    domains: Object.freeze([...new Set(item.urls.map(value => new URL(value).hostname))]) });
}
