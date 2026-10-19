//! Hands the editor the files macOS opens with the app, from Finder or the
//! Dock.

// other platforms pass opened files differently and don't call `open` yet
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};

use tauri::{AppHandle, Emitter, Manager, State, Url};
use tauri_plugin_fs::FsExt;

/// Event that sends the editor files opened after it took the waiting ones.
const OPEN_FILES_EVENT: &str = "open-files";

/// Files opened before the editor was ready for them, or `None` once the
/// editor has taken them.
pub struct OpenedFiles(Mutex<Option<Vec<PathBuf>>>);

impl Default for OpenedFiles {
    fn default() -> Self {
        Self(Mutex::new(Some(Vec::new())))
    }
}

/// Lets the editor read and save the opened files, then hands them over, or
/// keeps them until the editor takes them.
pub fn open(app: &AppHandle, urls: Vec<Url>) {
    let mut paths = Vec::new();
    for path in urls.iter().filter_map(|url| url.to_file_path().ok()) {
        match app.fs_scope().allow_file(&path) {
            Ok(()) => paths.push(path),
            Err(error) => eprintln!("failed to allow {}: {error}", path.display()),
        }
    }
    if paths.is_empty() {
        return;
    }

    let opened = app.state::<OpenedFiles>();
    let mut waiting = opened.0.lock().unwrap_or_else(PoisonError::into_inner);
    match waiting.as_mut() {
        Some(waiting) => waiting.extend(paths),
        None => {
            if let Err(error) = app.emit(OPEN_FILES_EVENT, paths) {
                eprintln!("failed to send opened files: {error}");
            }
        }
    }
}

/// Returns the files opened before the editor was ready. Files opened later
/// arrive as events, so the editor must listen for them before calling this.
#[tauri::command]
pub fn take_opened_files(opened: State<OpenedFiles>) -> Vec<PathBuf> {
    opened
        .0
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .take()
        .unwrap_or_default()
}
