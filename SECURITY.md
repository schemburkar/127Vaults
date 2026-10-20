# Security policy

127Vaults is designed to keep readable vault contents on authorized devices.
Vaults are encrypted and decrypted by the client. The self-hosted server stores
encrypted vault records persistently so devices can synchronize even when other
devices are offline; it is not a temporary relay. 127Vaults does not operate a
hosted vault-storage service for your installation.

## Encryption and access

The vault format uses Argon2id for password-based key derivation, HKDF-SHA-256
for key derivation, and XChaCha20-Poly1305 authenticated encryption. Authenticated
encryption protects both confidentiality and the integrity of encrypted records.
Device enrollment, vault membership and revocation control access across clients.
Revoking access cannot erase information a recipient has already decrypted or copied.

The server also holds operational metadata, including accounts, device records
and synchronization state. Encryption does not hide all metadata. Server backups
must be protected, and administrators are responsible for securing their installation,
transport configuration and recovery material.

## Client and recovery boundaries

A locked vault and encryption at rest help protect stored data. An unlocked client
must handle plaintext to display or use secrets, so the security of its operating
system matters. Clipboard contents, exports and secrets shared outside the vault
need their own protection. Keep recovery material private and stored safely.

Web access also requires trusting the server that delivers the client code:
a compromised server could alter that code. See the
[web client trust boundary](docs/security/web-client-boundary.md).

## Security documentation and reporting

The encryption design, client trust boundaries and implementation evidence are
documented in [security documentation](docs/security/).

Please report suspected vulnerabilities privately to the maintainers through the
existing private project support channel. Do not include vault contents, passwords,
recovery material or exploit details in public issues. Include the affected version,
impact and reproduction steps using test data so the issue can be investigated.
