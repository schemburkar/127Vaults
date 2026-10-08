import { readMetadata } from '../../../apps/extension/src/passkeys.mjs';

export function PasskeyDetails({ fields }: { fields: { id: string; type: string; value: string }[] }) {
  let metadata;
  try { metadata = readMetadata(fields); } catch { return <p role="alert">This passkey record is invalid. Restore a verified copy before using it.</p>; }
  if (!metadata) return null;
  return <section className="rounded-xl border border-white/10 p-4"><h3 className="font-semibold">Website passkey</h3><p className="mt-2 text-sm">{metadata.rpId} · {metadata.displayName || metadata.username}</p><p className="mt-2 text-xs text-slate-400">Use the 127Vaults extension on this website and approve with your master password. The private key stays encrypted in your vault. To revoke access, also remove this passkey from the website’s account settings.</p></section>;
}
