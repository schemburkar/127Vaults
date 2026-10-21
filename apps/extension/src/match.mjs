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
  // Port is significant. No eTLD/suffix matching or HTTP downgrade.
  return Boolean(saved && page && saved === page);
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
