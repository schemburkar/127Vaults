use std::time::{Duration, Instant};

pub const IDLE_TIMEOUT: Duration = Duration::from_secs(30 * 60);

pub struct IdleLease {
    epoch: u64,
    last_activity: Instant,
}
impl IdleLease {
    pub fn new(epoch: u64, now: Instant) -> Self {
        Self {
            epoch,
            last_activity: now,
        }
    }
    pub fn touch(&mut self, epoch: u64, now: Instant) {
        if self.epoch == epoch && !self.expired(epoch, now) {
            self.last_activity = now;
        }
    }
    pub fn expired(&self, epoch: u64, now: Instant) -> bool {
        self.epoch == epoch && now.saturating_duration_since(self.last_activity) >= IDLE_TIMEOUT
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn inactivity_expiry_does_not_depend_on_a_connector() {
        let now = Instant::now();
        let mut lease = IdleLease::new(2, now);
        assert!(lease.expired(2, now + IDLE_TIMEOUT));
        assert!(!lease.expired(3, now + IDLE_TIMEOUT));
        lease.touch(1, now + IDLE_TIMEOUT);
        assert!(lease.expired(2, now + IDLE_TIMEOUT));
        lease.touch(2, now + IDLE_TIMEOUT);
        assert!(lease.expired(2, now + IDLE_TIMEOUT));
        let mut active = IdleLease::new(2, now);
        active.touch(2, now + IDLE_TIMEOUT / 2);
        assert!(!active.expired(2, now + IDLE_TIMEOUT));
        assert!(active.expired(2, now + IDLE_TIMEOUT + IDLE_TIMEOUT / 2));
    }
}
