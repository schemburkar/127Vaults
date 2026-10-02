# Threat model (working draft)

## Assets

Vault plaintext, derived and random keys, device private keys, account secret,
master password, recovery material, session credentials, and integrity/history
of vault state.

## Adversaries in scope

- Database, backup, or object-store thief.
- Malicious or compromised 127Vaults server.
- Network attacker, including on a local network.
- Attacker with a user's password but not their account secret/trusted device.
- Revoked or malicious member/device.
- Stolen device, with locked and unlocked states analyzed separately.
- Malicious web page interacting with the browser extension.
- Supply-chain attacker affecting builds, updates, or dependencies.

## Initial security goals

- Stored ciphertext remains confidential after database or passive server
  compromise. Active server-delivered web code can steal credentials and plaintext;
  web access requires trusting that server. See the
  [web client trust boundary](web-client-boundary.md).
- Honest clients reject unauthorized operations even if served by a malicious
  server; this assumes the client code itself remains trusted.
- Rollback, replay, omission, and reordering have defined detection behavior.
- Device enrollment requires a deliberate trust transition.
- Revocation prevents future access/updates; it cannot erase data previously
  decrypted or copied by that device.
- Sharing exposes only the explicitly shared vault to authorized recipients.
- Backups and exports have explicit confidentiality and recovery properties.

## Explicit non-goals / unavoidable limits

- Protecting plaintext from a fully compromised, unlocked client OS.
- Preventing an authorized recipient from copying a revealed secret.
- Hiding all metadata from the service in the first release.
- Claiming audited or production-grade security before independent review.

## Unresolved high-risk areas

See the product questionnaire, key hierarchy, device enrollment, recovery,
sharing/revocation, browser-extension boundary, update signing, and sync
rollback/fork detection.
