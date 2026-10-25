//! Offers to install a newer release, which the app looks for on GitHub when
//! it starts.

use std::error::Error;

use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_dialog::{
    DialogExt, MessageDialogBuilder, MessageDialogButtons, MessageDialogKind,
};
use tauri_plugin_updater::UpdaterExt;

/// Event that asks the editor to save the drawing and then restart the app.
const RESTART_REQUESTED_EVENT: &str = "restart-requested";

/// Looks for a newer release without holding up the app.
pub fn check_in_background(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = check(&app).await {
            eprintln!("failed to update Setsquare: {error}");
        }
    });
}

async fn check(app: &AppHandle) -> Result<(), Box<dyn Error + Send + Sync>> {
    let Some(update) = app.updater()?.check().await? else {
        return Ok(());
    };

    let install = ask(message(
        app,
        format!(
            "Setsquare {} is available. You have {}.",
            update.version, update.current_version
        ),
    )
    .title("Update Available")
    .buttons(MessageDialogButtons::OkCancelCustom(
        "Install".into(),
        "Later".into(),
    )))
    .await?;
    if !install {
        return Ok(());
    }

    if let Err(error) = update.download_and_install(|_, _| {}, || {}).await {
        message(
            app,
            format!("Setsquare couldn't install the update: {error}"),
        )
        .title("Update Failed")
        .kind(MessageDialogKind::Error)
        .show(|_| {});
        return Err(error.into());
    }

    // the user may have been drawing while the update downloaded, so the app
    // only restarts when they say so, and once the editor has saved
    let restart = ask(message(
        app,
        format!(
            "Setsquare {} is installed and starts the next time you open it. Restart now?",
            update.version
        ),
    )
    .title("Update Installed")
    .buttons(MessageDialogButtons::OkCancelCustom(
        "Restart".into(),
        "Later".into(),
    )))
    .await?;
    if restart {
        app.emit(RESTART_REQUESTED_EVENT, ())?;
    }
    Ok(())
}

/// Shows a question and waits for the answer without blocking the app.
async fn ask(prompt: MessageDialogBuilder<Wry>) -> tauri::Result<bool> {
    tauri::async_runtime::spawn_blocking(move || prompt.blocking_show()).await
}

/// A message shown as a sheet on the main window. Without a window, macOS
/// shows a system alert instead, which isn't tied to the app.
fn message(app: &AppHandle, text: String) -> MessageDialogBuilder<Wry> {
    let dialog = app.dialog().message(text);
    match app.get_webview_window("main") {
        Some(window) => dialog.parent(&window),
        None => dialog,
    }
}
