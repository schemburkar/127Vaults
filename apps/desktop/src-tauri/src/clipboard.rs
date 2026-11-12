use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};
use zeroize::Zeroizing;

pub struct Lease {
    owner: String,
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    token: String,
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    active: Arc<AtomicBool>,
    expires: Instant,
}
#[derive(Default)]
pub struct ClipboardState(Mutex<Option<Lease>>);
static GENERATION: AtomicU64 = AtomicU64::new(0);

impl ClipboardState {
    // Called only on Tauri's native main thread, including window destruction.
    pub fn copy(&self, owner: String, value: String) -> Result<(), String> {
        let value = Zeroizing::new(value);
        let token = format!(
            "{}-{}",
            std::process::id(),
            GENERATION.fetch_add(1, Ordering::Relaxed)
        );
        let mut lease = self
            .0
            .lock()
            .map_err(|_| "Clipboard state is unavailable")?;
        let active = Arc::new(AtomicBool::new(true));
        write(&value, &token, active.clone())?;
        *lease = Some(Lease {
            owner,
            token,
            active,
            expires: Instant::now() + Duration::from_secs(30),
        });
        Ok(())
    }
    pub fn clear(&self, owner: Option<&str>, force: bool) {
        if let Ok(mut saved) = self.0.lock()
            && saved
                .as_ref()
                .is_some_and(|lease| should_clear(lease, owner, force, Instant::now()))
            && saved
                .as_ref()
                .is_some_and(|lease| clear_owned(lease).is_ok())
        {
            saved.take();
        }
    }
}

fn should_clear(lease: &Lease, owner: Option<&str>, force: bool, now: Instant) -> bool {
    owner.is_none_or(|owner| lease.owner == owner) && (force || now >= lease.expires)
}

#[cfg(target_os = "linux")]
fn write(value: &str, _token: &str, active: Arc<AtomicBool>) -> Result<(), String> {
    struct Payload {
        value: Zeroizing<String>,
        active: Arc<AtomicBool>,
    }
    impl Drop for Payload {
        fn drop(&mut self) {
            self.active.store(false, Ordering::Release);
        }
    }
    let payload = Payload {
        value: Zeroizing::new(value.to_owned()),
        active,
    };
    let targets = ["UTF8_STRING", "TEXT", "STRING", "text/plain;charset=utf-8"]
        .map(|target| gtk::TargetEntry::new(target, gtk::TargetFlags::empty(), 0));
    if gtk::Clipboard::get(&gtk::gdk::SELECTION_CLIPBOARD).set_with_data(
        &targets,
        move |_, selection, _| {
            selection.set_text(&payload.value);
        },
    ) {
        Ok(())
    } else {
        Err("Could not copy to the system clipboard".into())
    }
}
#[cfg(target_os = "linux")]
fn clear_owned(lease: &Lease) -> Result<(), String> {
    // GTK drops our data provider when another owner replaces the selection.
    // No foreign clipboard read or renderer callback is needed during close.
    if lease.active.load(Ordering::Acquire) {
        gtk::Clipboard::get(&gtk::gdk::SELECTION_CLIPBOARD).clear();
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn write(value: &str, token: &str, _active: Arc<AtomicBool>) -> Result<(), String> {
    use windows::{
        ApplicationModel::DataTransfer::{Clipboard, ClipboardContentOptions, DataPackage},
        Foundation::PropertyValue,
        core::HSTRING,
    };
    let operation = || -> windows::core::Result<bool> {
        let data = DataPackage::new()?;
        data.SetText(&HSTRING::from(value))?;
        data.Properties()?.Insert(
            &HSTRING::from("127VaultsClipboardLease"),
            &PropertyValue::CreateString(&HSTRING::from(token))?,
        )?;
        let options = ClipboardContentOptions::new()?;
        options.SetIsAllowedInHistory(false)?;
        options.SetIsRoamable(false)?;
        Clipboard::SetContentWithOptions(&data, &options)
    };
    match operation() {
        Ok(true) => Ok(()),
        _ => Err("Could not copy to the system clipboard".into()),
    }
}
#[cfg(target_os = "windows")]
fn clear_owned(lease: &Lease) -> Result<(), String> {
    use windows::{
        ApplicationModel::DataTransfer::Clipboard,
        Foundation::IPropertyValue,
        core::{HSTRING, Interface},
    };
    let operation = || -> windows::core::Result<()> {
        let properties = Clipboard::GetContent()?.Properties()?;
        let key = HSTRING::from("127VaultsClipboardLease");
        if !properties.HasKey(&key)? {
            return Ok(());
        }
        let marker = properties
            .Lookup(&key)?
            .cast::<IPropertyValue>()?
            .GetString()?;
        if marker == lease.token.as_str() {
            Clipboard::Clear()?;
        }
        Ok(())
    };
    operation().map_err(|_| "Clipboard cleanup will retry".to_owned())
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn write(_value: &str, _token: &str, _active: Arc<AtomicBool>) -> Result<(), String> {
    Err("Native clipboard is unavailable on this platform".into())
}
#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn clear_owned(_lease: &Lease) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cleanup_survives_window_closure_and_only_matches_the_current_owner() {
        let now = Instant::now();
        let lease = Lease {
            owner: "detached".into(),
            token: "synthetic".into(),
            active: Arc::new(AtomicBool::new(true)),
            expires: now + Duration::from_secs(30),
        };
        assert!(!should_clear(&lease, None, false, now));
        assert!(should_clear(&lease, None, false, lease.expires));
        assert!(!should_clear(&lease, Some("main"), true, now));
        assert!(should_clear(&lease, Some("detached"), true, now));
        assert!(should_clear(&lease, None, true, now));
    }
    #[cfg(target_os = "linux")]
    #[test]
    #[ignore = "requires an isolated Xvfb display"]
    fn native_clipboard_close_and_foreign_replacement() {
        gtk::init().expect("isolated display");
        let state = ClipboardState::default();
        let clipboard = gtk::Clipboard::get(&gtk::gdk::SELECTION_CLIPBOARD);
        state
            .copy("detached".into(), "synthetic-secret".into())
            .unwrap();
        assert_eq!(
            clipboard.wait_for_text().as_deref(),
            Some("synthetic-secret")
        );
        state.clear(Some("main"), true);
        assert_eq!(
            clipboard.wait_for_text().as_deref(),
            Some("synthetic-secret")
        );
        clipboard.set_text("newer-unrelated-text");
        state.clear(None, true);
        assert_eq!(
            clipboard.wait_for_text().as_deref(),
            Some("newer-unrelated-text")
        );
        state
            .copy("detached".into(), "second-synthetic-secret".into())
            .unwrap();
        state.clear(Some("detached"), true);
        assert!(clipboard.wait_for_text().is_none());
    }
}
