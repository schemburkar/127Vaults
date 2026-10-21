// An exact DNS identity is distinct from the private address we publish on.
// No wildcard, URL, DNS search suffix, mDNS or localhost-subdomain expansion.
export function validServerHostname(value) {
  return typeof value === 'string' && value === value.toLowerCase() && value.length <= 253
    && value.includes('.') && !/^\d+(?:\.\d+)*$/.test(value)
    && !['local', 'localhost'].some(suffix => value === suffix || value.endsWith(`.${suffix}`))
    && value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}
