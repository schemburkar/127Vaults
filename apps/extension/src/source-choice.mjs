// Source preference is a non-secret enum, never a vault address or credential.
export function chooseSource(options, preferred) {
  const remembered = ['desktop', 'cli', 'web'].includes(preferred) && options.find(option => option.id === preferred);
  const chosen = remembered || options.find(option => option.id === 'desktop' && option.preferred)
    || options.find(option => option.preferred) || options[0];
  return { id: chosen?.id ?? null, fallback: Boolean(preferred && !remembered) };
}
