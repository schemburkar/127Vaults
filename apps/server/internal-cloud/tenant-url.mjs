import { cloudLandingHost } from './landing.mjs';

export const cloudPublicOrigin = `https://${cloudLandingHost}`;
const slugPattern = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const slugRegex = new RegExp(`^${slugPattern}$`);
const routeRegex = new RegExp(`^/t/(${slugPattern})(/.*)$`);

export const validCloudSlug = slug => typeof slug === 'string' && slugRegex.test(slug);
export const cloudTenantUrl = (slug, origin = cloudPublicOrigin) => `${origin}/t/${slug}/`;

export function splitCloudTenantRoute(url) {
  if (typeof url !== 'string') return null;
  const path = url.split('?')[0];
  const match = routeRegex.exec(path);
  if (!match || /[\\%]/.test(path) || path.includes('//') || /(?:^|\/)\.{1,2}(?:\/|$)/.test(path)) return null;
  return { slug: match[1], route: url.slice(`/t/${match[1]}`.length) };
}
