// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "macos")]
mod menu;
mod opened_files;

fn main() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(opened_files::OpenedFiles::default())
        .invoke_handler(tauri::generate_handler![opened_files::take_opened_files]);
    #[cfg(target_os = "macos")]
    let builder = builder.menu(menu::build).on_menu_event(menu::forward);

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
