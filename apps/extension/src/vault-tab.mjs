import { originOf } from './match.mjs';

export async function findUnlockedVaultTab(tabs, origin, activeId, probe) {
  const candidates = tabs.filter(tab => tab.id && originOf(tab.url) === origin);
  candidates.sort((a, b) => Number(b.id === activeId) - Number(a.id === activeId));
  let failure;
  for (const tab of candidates) {
    try {
      const available = await probe(tab.id);
      if (available && !available.locked) return tab;
    } catch (error) { failure = error; }
  }
  if (failure && candidates.length) throw failure;
  return candidates[0] || null;
}
