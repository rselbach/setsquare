//! The macOS menu bar: Tauri's standard menus, plus the editor's commands.

use tauri::menu::{
    Menu, MenuBuilder, MenuEvent, MenuItem, SubmenuBuilder, HELP_SUBMENU_ID, WINDOW_SUBMENU_ID,
};
use tauri::{AppHandle, Emitter};

/// Event that sends the editor the ID of the menu command the user picked.
const MENU_EVENT: &str = "menu";

/// Builds the menu bar. The editor's commands use the editor's own shortcuts,
/// which reach the editor first, so the menu mostly runs them when clicked.
/// Undo, Redo and Select All are editor commands too, because the standard
/// ones only edit text and never reach the drawing.
pub fn build(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let command = |id: &str, text: &str, shortcut: &str| {
        MenuItem::with_id(app, id, text, true, Some(shortcut))
    };

    let app_menu = SubmenuBuilder::new(app, "Setsquare")
        .about(None)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .separator()
        .quit()
        .build()?;
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&command("open", "Open…", "CmdOrCtrl+O")?)
        .separator()
        .close_window()
        .item(&command("save", "Save", "CmdOrCtrl+S")?)
        .item(&command("save-as", "Save As…", "CmdOrCtrl+Shift+S")?)
        .separator()
        .item(&command(
            "export-image",
            "Export Image…",
            "CmdOrCtrl+Shift+E",
        )?)
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&command("undo", "Undo", "CmdOrCtrl+Z")?)
        .item(&command("redo", "Redo", "CmdOrCtrl+Shift+Z")?)
        .separator()
        .cut()
        .copy()
        .paste()
        .item(&command("select-all", "Select All", "CmdOrCtrl+A")?)
        .build()?;
    let view_menu = SubmenuBuilder::new(app, "View").fullscreen().build()?;
    let window_menu = SubmenuBuilder::with_id(app, WINDOW_SUBMENU_ID, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;
    let help_menu = SubmenuBuilder::with_id(app, HELP_SUBMENU_ID, "Help").build()?;

    MenuBuilder::new(app)
        .items(&[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ])
        .build()
}

/// Sends a picked command to the editor, which knows how to run it.
pub fn forward(app: &AppHandle, event: MenuEvent) {
    if let Err(error) = app.emit(MENU_EVENT, event.id().as_ref()) {
        eprintln!("failed to send menu command {:?}: {error}", event.id());
    }
}
