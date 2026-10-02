//! Authenticated PVD1/PVM1 records for the disposable private-vault slice.
#![allow(clippy::missing_errors_doc)]
use hkdf::Hkdf;
use hmac::{Hmac, KeyInit, Mac};
use sha2::{Digest, Sha256};

const DIRECTORY_MAGIC: &[u8; 4] = b"PVD1";
const CATALOGUE_MAGIC: &[u8; 4] = b"PVM1";
const DIRECTORY_FIXED: usize = 102;
const CATALOGUE_FIXED: usize = 110;
const DIRECTORY_ENTRY: usize = 72;
const CATALOGUE_ENTRY: usize = 136;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RecordError {
    InvalidInput,
    AuthenticationFailed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DirectoryEntry {
    pub vault: [u8; 16],
    pub epoch: u64,
    pub envelope_revision: [u8; 16],
    pub envelope_sha256: [u8; 32],
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Directory {
    pub tenant: [u8; 16],
    pub account: [u8; 16],
    pub revision: [u8; 16],
    pub base: [u8; 16],
    pub entries: Vec<DirectoryEntry>,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CatalogueEntry {
    pub item: [u8; 16],
    pub logical_revision: [u8; 16],
    pub index_revision: [u8; 16],
    pub body_revision: [u8; 16],
    pub index_length: u32,
    pub body_length: u32,
    pub index_sha256: [u8; 32],
    pub body_sha256: [u8; 32],
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Catalogue {
    pub tenant: [u8; 16],
    pub vault: [u8; 16],
    pub epoch: u64,
    pub revision: [u8; 16],
    pub base: [u8; 16],
    pub entries: Vec<CatalogueEntry>,
}

fn uuid(x: &[u8; 16], nil_ok: bool) -> bool {
    (nil_ok && x.iter().all(|b| *b == 0))
        || (x.iter().any(|b| *b != 0)
            && x.iter().any(|b| *b != 0xff)
            && (x[8] & 0xc0) == 0x80
            && matches!(x[6] >> 4, 4 | 7))
}
fn revision(x: &[u8; 16], nil_ok: bool) -> bool {
    uuid(x, nil_ok) && (x.iter().all(|b| *b == 0) || (x[6] >> 4) == 4)
}
fn key(
    secret: &[u8; 32],
    salt: &[u8],
    label: &[u8],
    scope: &[u8],
) -> Result<[u8; 32], RecordError> {
    let hk = Hkdf::<Sha256>::new(Some(salt), secret);
    let mut out = [0; 32];
    let mut info = Vec::with_capacity(label.len() + 1 + scope.len());
    info.extend_from_slice(label);
    info.push(0);
    info.extend_from_slice(scope);
    hk.expand(&info, &mut out)
        .map_err(|_| RecordError::InvalidInput)?;
    Ok(out)
}
fn tag(
    secret: &[u8; 32],
    salt: &[u8],
    label: &[u8],
    scope: &[u8],
    body: &[u8],
) -> Result<[u8; 32], RecordError> {
    let k = key(secret, salt, label, scope)?;
    let mut mac = Hmac::<Sha256>::new_from_slice(&k).map_err(|_| RecordError::InvalidInput)?;
    mac.update(body);
    Ok(mac.finalize().into_bytes().into())
}
fn verify_tag(
    secret: &[u8; 32],
    salt: &[u8],
    label: &[u8],
    scope: &[u8],
    body: &[u8],
    claimed: &[u8],
) -> Result<(), RecordError> {
    let k = key(secret, salt, label, scope)?;
    let mut mac = Hmac::<Sha256>::new_from_slice(&k).map_err(|_| RecordError::InvalidInput)?;
    mac.update(body);
    mac.verify_slice(claimed)
        .map_err(|_| RecordError::AuthenticationFailed)
}
fn take16(input: &[u8], p: &mut usize) -> Result<[u8; 16], RecordError> {
    let end = p.checked_add(16).ok_or(RecordError::InvalidInput)?;
    let v = input
        .get(*p..end)
        .ok_or(RecordError::InvalidInput)?
        .try_into()
        .map_err(|_| RecordError::InvalidInput)?;
    *p = end;
    Ok(v)
}
fn take32(input: &[u8], p: &mut usize) -> Result<[u8; 32], RecordError> {
    let end = p.checked_add(32).ok_or(RecordError::InvalidInput)?;
    let v = input
        .get(*p..end)
        .ok_or(RecordError::InvalidInput)?
        .try_into()
        .map_err(|_| RecordError::InvalidInput)?;
    *p = end;
    Ok(v)
}
fn push_tag(mut out: Vec<u8>, t: [u8; 32]) -> Vec<u8> {
    out.extend_from_slice(&t);
    out
}
fn sorted_unique<T>(v: &[T], id: impl Fn(&T) -> &[u8; 16]) -> bool {
    v.windows(2).all(|w| id(&w[0]) < id(&w[1]))
}

impl Directory {
    pub fn encode(&self, root: &[u8; 32]) -> Result<Vec<u8>, RecordError> {
        if !uuid(&self.tenant, false)
            || !uuid(&self.account, false)
            || !revision(&self.revision, false)
            || !revision(&self.base, true)
            || self.entries.len() > 5
            || !sorted_unique(&self.entries, |e| &e.vault)
        {
            return Err(RecordError::InvalidInput);
        }
        let mut out = Vec::with_capacity(DIRECTORY_FIXED + self.entries.len() * DIRECTORY_ENTRY);
        out.extend_from_slice(DIRECTORY_MAGIC);
        out.extend_from_slice(&self.tenant);
        out.extend_from_slice(&self.account);
        out.extend_from_slice(&self.revision);
        out.extend_from_slice(&self.base);
        out.extend_from_slice(
            &u16::try_from(self.entries.len())
                .map_err(|_| RecordError::InvalidInput)?
                .to_be_bytes(),
        );
        for e in &self.entries {
            if !uuid(&e.vault, false) || e.epoch == 0 || !revision(&e.envelope_revision, false) {
                return Err(RecordError::InvalidInput);
            }
            out.extend_from_slice(&e.vault);
            out.extend_from_slice(&e.epoch.to_be_bytes());
            out.extend_from_slice(&e.envelope_revision);
            out.extend_from_slice(&e.envelope_sha256);
        }
        let mut scope = Vec::with_capacity(32);
        scope.extend_from_slice(&self.tenant);
        scope.extend_from_slice(&self.account);
        let t = tag(
            root,
            b"127Vaults/PVD1/root",
            b"127Vaults/PVD1/mac",
            &scope,
            &out,
        )?;
        Ok(push_tag(out, t))
    }
    pub fn decode(
        input: &[u8],
        root: &[u8; 32],
        tenant: [u8; 16],
        account: [u8; 16],
    ) -> Result<Self, RecordError> {
        if input.len() < DIRECTORY_FIXED || input.get(..4) != Some(DIRECTORY_MAGIC) {
            return Err(RecordError::InvalidInput);
        }
        let count = u16::from_be_bytes(
            input[68..70]
                .try_into()
                .map_err(|_| RecordError::InvalidInput)?,
        ) as usize;
        if count > 5 || input.len() != DIRECTORY_FIXED + count * DIRECTORY_ENTRY {
            return Err(RecordError::InvalidInput);
        }
        let mut scope = Vec::with_capacity(32);
        scope.extend_from_slice(&tenant);
        scope.extend_from_slice(&account);
        let body = &input[..input.len() - 32];
        verify_tag(
            root,
            b"127Vaults/PVD1/root",
            b"127Vaults/PVD1/mac",
            &scope,
            body,
            &input[input.len() - 32..],
        )?;
        let mut p = 4;
        let got_t = take16(input, &mut p)?;
        let got_a = take16(input, &mut p)?;
        let rev = take16(input, &mut p)?;
        let base = take16(input, &mut p)?;
        p += 2;
        if got_t != tenant || got_a != account {
            return Err(RecordError::AuthenticationFailed);
        }
        let mut entries = Vec::with_capacity(count);
        for _ in 0..count {
            entries.push(DirectoryEntry {
                vault: take16(input, &mut p)?,
                epoch: {
                    let x = u64::from_be_bytes(
                        input[p..p + 8]
                            .try_into()
                            .map_err(|_| RecordError::InvalidInput)?,
                    );
                    p += 8;
                    x
                },
                envelope_revision: take16(input, &mut p)?,
                envelope_sha256: take32(input, &mut p)?,
            });
        }
        let value = Self {
            tenant,
            account,
            revision: rev,
            base,
            entries,
        };
        value.encode(root)?;
        Ok(value)
    }
}
impl Catalogue {
    pub fn encode(&self, vault_key: &[u8; 32]) -> Result<Vec<u8>, RecordError> {
        if !uuid(&self.tenant, false)
            || !uuid(&self.vault, false)
            || self.epoch == 0
            || !revision(&self.revision, false)
            || !revision(&self.base, true)
            || self.entries.len() > 50
            || !sorted_unique(&self.entries, |e| &e.item)
        {
            return Err(RecordError::InvalidInput);
        }
        let mut out = Vec::with_capacity(CATALOGUE_FIXED + self.entries.len() * CATALOGUE_ENTRY);
        out.extend_from_slice(CATALOGUE_MAGIC);
        out.extend_from_slice(&self.tenant);
        out.extend_from_slice(&self.vault);
        out.extend_from_slice(&self.epoch.to_be_bytes());
        out.extend_from_slice(&self.revision);
        out.extend_from_slice(&self.base);
        out.extend_from_slice(
            &u16::try_from(self.entries.len())
                .map_err(|_| RecordError::InvalidInput)?
                .to_be_bytes(),
        );
        for e in &self.entries {
            if !uuid(&e.item, false)
                || !revision(&e.logical_revision, false)
                || !revision(&e.index_revision, false)
                || !revision(&e.body_revision, false)
                || e.index_length == 0
                || e.body_length == 0
            {
                return Err(RecordError::InvalidInput);
            }
            out.extend_from_slice(&e.item);
            out.extend_from_slice(&e.logical_revision);
            out.extend_from_slice(&e.index_revision);
            out.extend_from_slice(&e.body_revision);
            out.extend_from_slice(&e.index_length.to_be_bytes());
            out.extend_from_slice(&e.body_length.to_be_bytes());
            out.extend_from_slice(&e.index_sha256);
            out.extend_from_slice(&e.body_sha256);
        }
        let mut scope = Vec::with_capacity(40);
        scope.extend_from_slice(&self.tenant);
        scope.extend_from_slice(&self.vault);
        scope.extend_from_slice(&self.epoch.to_be_bytes());
        let t = tag(
            vault_key,
            b"127Vaults/PVM1/vault",
            b"127Vaults/PVM1/mac",
            &scope,
            &out,
        )?;
        Ok(push_tag(out, t))
    }
    pub fn decode(
        input: &[u8],
        vault_key: &[u8; 32],
        tenant: [u8; 16],
        vault: [u8; 16],
        epoch: u64,
    ) -> Result<Self, RecordError> {
        if input.len() < CATALOGUE_FIXED || input.get(..4) != Some(CATALOGUE_MAGIC) {
            return Err(RecordError::InvalidInput);
        }
        let count = u16::from_be_bytes(
            input[76..78]
                .try_into()
                .map_err(|_| RecordError::InvalidInput)?,
        ) as usize;
        if count > 50 || input.len() != CATALOGUE_FIXED + count * CATALOGUE_ENTRY {
            return Err(RecordError::InvalidInput);
        }
        let mut scope = Vec::with_capacity(40);
        scope.extend_from_slice(&tenant);
        scope.extend_from_slice(&vault);
        scope.extend_from_slice(&epoch.to_be_bytes());
        verify_tag(
            vault_key,
            b"127Vaults/PVM1/vault",
            b"127Vaults/PVM1/mac",
            &scope,
            &input[..input.len() - 32],
            &input[input.len() - 32..],
        )?;
        let mut p = 4;
        let got_t = take16(input, &mut p)?;
        let got_v = take16(input, &mut p)?;
        let got_e = u64::from_be_bytes(
            input[p..p + 8]
                .try_into()
                .map_err(|_| RecordError::InvalidInput)?,
        );
        p += 8;
        let rev = take16(input, &mut p)?;
        let base = take16(input, &mut p)?;
        p += 2;
        if (got_t, got_v, got_e) != (tenant, vault, epoch) {
            return Err(RecordError::AuthenticationFailed);
        }
        let mut entries = Vec::with_capacity(count);
        for _ in 0..count {
            entries.push(CatalogueEntry {
                item: take16(input, &mut p)?,
                logical_revision: take16(input, &mut p)?,
                index_revision: take16(input, &mut p)?,
                body_revision: take16(input, &mut p)?,
                index_length: {
                    let x = u32::from_be_bytes(
                        input[p..p + 4]
                            .try_into()
                            .map_err(|_| RecordError::InvalidInput)?,
                    );
                    p += 4;
                    x
                },
                body_length: {
                    let x = u32::from_be_bytes(
                        input[p..p + 4]
                            .try_into()
                            .map_err(|_| RecordError::InvalidInput)?,
                    );
                    p += 4;
                    x
                },
                index_sha256: take32(input, &mut p)?,
                body_sha256: take32(input, &mut p)?,
            });
        }
        let value = Self {
            tenant,
            vault,
            epoch,
            revision: rev,
            base,
            entries,
        };
        value.encode(vault_key)?;
        Ok(value)
    }
}
#[must_use]
pub fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}
pub fn random_revision() -> Result<[u8; 16], RecordError> {
    let mut x = [0; 16];
    getrandom::fill(&mut x).map_err(|_| RecordError::InvalidInput)?;
    x[6] = (x[6] & 0x0f) | 0x40;
    x[8] = (x[8] & 0x3f) | 0x80;
    Ok(x)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn id(n: u8) -> [u8; 16] {
        let mut x = [n; 16];
        x[6] = 0x40;
        x[8] = 0x80;
        x
    }
    #[test]
    fn exact_records_and_tamper() {
        let k = [7; 32];
        let d = Directory {
            tenant: id(1),
            account: id(2),
            revision: id(3),
            base: [0; 16],
            entries: vec![DirectoryEntry {
                vault: id(4),
                epoch: 1,
                envelope_revision: id(5),
                envelope_sha256: [6; 32],
            }],
        };
        let bytes = d.encode(&k).unwrap();
        assert_eq!(bytes.len(), 174);
        assert_eq!(Directory::decode(&bytes, &k, id(1), id(2)).unwrap(), d);
        let mut bad = bytes;
        bad[80] ^= 1;
        assert_eq!(
            Directory::decode(&bad, &k, id(1), id(2)),
            Err(RecordError::AuthenticationFailed)
        );
        let m = Catalogue {
            tenant: id(1),
            vault: id(4),
            epoch: 1,
            revision: id(5),
            base: [0; 16],
            entries: vec![CatalogueEntry {
                item: id(6),
                logical_revision: id(7),
                index_revision: id(8),
                body_revision: id(9),
                index_length: 174,
                body_length: 200,
                index_sha256: [10; 32],
                body_sha256: [11; 32],
            }],
        };
        let b = m.encode(&k).unwrap();
        assert_eq!(b.len(), 246);
        assert_eq!(Catalogue::decode(&b, &k, id(1), id(4), 1).unwrap(), m);
    }
}
