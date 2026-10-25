// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod opened_files;
mod quit;
mod saved_files;
mod updater;

/// Restarts the app into an installed update. The editor calls this once it
/// has saved the drawing.
#[tauri::command]
fn restart(app: tauri::AppHandle) {
    app.request_restart();
}

fn main() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(opened_files::OpenedFiles::default())
        .invoke_handler(tauri::generate_handler![
            opened_files::take_opened_files,
            saved_files::save_file,
            quit::quit,
            restart
        ])
        .setup(|app| {
            quit::watch(app.handle());
            // development builds aren't installed anywhere an update could
            // replace
            if !cfg!(debug_assertions) {
                updater::check_in_background(app.handle());
            }
            Ok(())
        });

    let app = builder
        .build(tauri::generate_context!())
        .expect("failed to build Setsquare");
    app.run(|_app, _event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = _event {
            opened_files::open(_app, urls);
        }
    });
}
