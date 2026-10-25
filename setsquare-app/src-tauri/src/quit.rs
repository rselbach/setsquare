//! Quits the app only once the editor has saved the drawing locally. Quit
//! Setsquare and closing the window go through the editor first; quits from
//! the system, such as the Dock's Quit or logging out, wait for it here.

use tauri::AppHandle;

/// Quits the app. The editor calls this once it has saved the drawing.
#[tauri::command]
pub fn quit(app: AppHandle) {
    #[cfg(target_os = "macos")]
    if macos::finish_quitting(&app) {
        return;
    }
    app.exit(0);
}

/// Makes quits from the system wait for the editor to save the drawing.
pub fn watch(_app: &AppHandle) {
    #[cfg(target_os = "macos")]
    macos::watch(_app);
}

#[cfg(target_os = "macos")]
mod macos {
    use std::mem;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::OnceLock;
    use std::thread;
    use std::time::Duration;

    use objc2::ffi::class_addMethod;
    use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
    use objc2::{class, msg_send, sel};
    use tauri::{AppHandle, Emitter};

    // `NSApplicationTerminateReply` values
    const TERMINATE_NOW: usize = 1;
    const TERMINATE_LATER: usize = 2;

    // how long a quit waits for an editor that doesn't answer, so a stuck
    // editor can't hold up logging out
    const TIMEOUT: Duration = Duration::from_secs(5);

    type ShouldTerminate = unsafe extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject) -> usize;

    static APP: OnceLock<AppHandle> = OnceLock::new();
    // set while a quit from the system waits for the editor
    static WAITING: AtomicBool = AtomicBool::new(false);

    pub fn watch(app: &AppHandle) {
        if APP.set(app.clone()).is_err() {
            return;
        }
        // tao's app delegate doesn't answer `applicationShouldTerminate:`, so
        // AppKit quits without asking; teach it to
        let handler: ShouldTerminate = should_terminate;
        let added = unsafe {
            let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let delegate: *mut AnyObject = msg_send![ns_app, delegate];
            let Some(delegate) = delegate.as_ref() else {
                eprintln!("couldn't watch for quits: the app has no delegate");
                return;
            };
            class_addMethod(
                delegate.class() as *const AnyClass as *mut AnyClass,
                sel!(applicationShouldTerminate:),
                mem::transmute::<ShouldTerminate, Imp>(handler),
                c"Q@:@".as_ptr(),
            )
        };
        if !added.as_bool() {
            eprintln!("couldn't watch for quits: the app delegate already answers them");
        }
    }

    /// Asks the editor to save, and holds the quit until it has.
    unsafe extern "C-unwind" fn should_terminate(
        _: &AnyObject,
        _: Sel,
        _: *mut AnyObject,
    ) -> usize {
        let Some(app) = APP.get() else {
            return TERMINATE_NOW;
        };
        WAITING.store(true, Ordering::SeqCst);
        if let Err(error) = app.emit("quit-requested", ()) {
            eprintln!("couldn't ask the editor to save before quitting: {error}");
            WAITING.store(false, Ordering::SeqCst);
            return TERMINATE_NOW;
        }
        let app = app.clone();
        thread::spawn(move || {
            thread::sleep(TIMEOUT);
            finish_quitting(&app);
        });
        TERMINATE_LATER
    }

    /// Lets a quit from the system go ahead. Returns whether one was waiting.
    pub fn finish_quitting(app: &AppHandle) -> bool {
        if !WAITING.swap(false, Ordering::SeqCst) {
            return false;
        }
        let replied = app.run_on_main_thread(|| unsafe {
            let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let _: () = msg_send![ns_app, replyToApplicationShouldTerminate: true];
        });
        if let Err(error) = replied {
            eprintln!("couldn't let the app quit: {error}");
        }
        true
    }
}
