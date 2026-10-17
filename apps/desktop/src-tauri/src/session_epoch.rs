use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Default)]
pub struct SessionEpoch(AtomicU64);

impl SessionEpoch {
    pub fn current(&self) -> u64 {
        self.0.load(Ordering::Acquire)
    }
    pub fn advance(&self) -> u64 {
        self.0.fetch_add(1, Ordering::AcqRel).wrapping_add(1)
    }
    pub fn revoke(&self, expected: u64) -> bool {
        self.0
            .compare_exchange(
                expected,
                expected.wrapping_add(1),
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::SessionEpoch;

    #[test]
    fn a_late_connector_probe_cannot_revoke_a_new_unlock() {
        let epoch = SessionEpoch::default();
        let first = epoch.advance();
        let second = epoch.advance();
        assert!(!epoch.revoke(first));
        assert_eq!(epoch.current(), second);
        assert!(epoch.revoke(second));
        assert!(!epoch.revoke(second));
    }
}
