export function originOf(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || !parsed.hostname || parsed.hostname.includes('*')) return null;
    return parsed.origin;
  } catch { return null; }
}

export function matchingLogin(website, pageUrl) {
  const saved = savedWebsiteOrigin(website);
  const page = originOf(pageUrl);
  if (!saved || !page) return false;
  const a = new URL(saved), b = new URL(page);
  const isIp = host => host.startsWith('[') || /^\d+\.\d+\.\d+\.\d+$/.test(host);
  // Only the conventional www/apex pair is equivalent. Other subdomains,
  // ports, permission origins and passkey RP matching remain separate.
  return a.port === b.port && (a.hostname === b.hostname
    || (!isIp(a.hostname) && !isIp(b.hostname)
      && (a.hostname === `www.${b.hostname}` || b.hostname === `www.${a.hostname}`)));
}

export function savedWebsiteOrigin(website) {
  if (typeof website !== 'string') return null;
  const value = website.trim();
  if (!value || /[\s\\]/u.test(value) || value.startsWith('//')) return null;
  return originOf(value.includes('://') ? value : `https://${value}`);
}

export function permissionPattern(origin) {
  const valid = originOf(origin);
  if (!valid) return null;
  // Chromium host permissions cannot be scoped to a port. The application
  // itself is still selected by its exact configured origin, including port.
  return `https://${new URL(valid).hostname}/*`;
}
