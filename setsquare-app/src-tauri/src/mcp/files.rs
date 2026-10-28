use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
};

use tauri::{AppHandle, State};
use tauri_plugin_fs::FsExt;

use super::McpState;

const MAX_FILE_BYTES: usize = 20 * 1024 * 1024;

fn request_path(state: &McpState, id: &str, tool: &str) -> Result<(PathBuf, bool), String> {
    let editor = state.bridge.lock();
    let pending = editor.pending.get(id).ok_or("File request expired")?;
    if pending.name != tool {
        return Err("Wrong file operation for this request".into());
    }
    let path = PathBuf::from(
        pending
            .args
            .get("path")
            .and_then(|value| value.as_str())
            .ok_or("Missing path")?,
    );
    if !path.is_absolute() || path.extension().and_then(|value| value.to_str()) != Some("setsquare")
    {
        return Err("Use an absolute path ending in .setsquare".into());
    }
    Ok((
        path,
        pending
            .args
            .get("overwrite")
            .and_then(|value| value.as_bool())
            .unwrap_or(false),
    ))
}

#[tauri::command]
pub fn mcp_read_document(
    app: AppHandle,
    state: State<McpState>,
    id: String,
) -> Result<String, String> {
    let (path, _) = request_path(&state, &id, "open_document")?;
    if fs::metadata(&path)
        .map_err(|error| error.to_string())?
        .len()
        > MAX_FILE_BYTES as u64
    {
        return Err("Drawing exceeds the 20 MiB file limit".into());
    }
    let contents = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    app.fs_scope()
        .allow_file(&path)
        .map_err(|error| error.to_string())?;
    Ok(contents)
}

#[tauri::command]
pub fn mcp_write_document(
    app: AppHandle,
    state: State<McpState>,
    id: String,
    contents: String,
) -> Result<(), String> {
    let (path, overwrite) = request_path(&state, &id, "save_document")?;
    if contents.len() > MAX_FILE_BYTES {
        return Err("Drawing exceeds the 20 MiB file limit".into());
    }
    app.fs_scope()
        .allow_file(&path)
        .map_err(|error| error.to_string())?;
    if overwrite {
        return crate::saved_files::replace(&path, contents.as_bytes())
            .map_err(|error| error.to_string());
    }
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|error| error.to_string())?;
    let result = file
        .write_all(contents.as_bytes())
        .and_then(|()| file.sync_all());
    if result.is_err() {
        if let Err(error) = fs::remove_file(&path) {
            eprintln!("couldn't remove incomplete drawing: {error}");
        }
    }
    result.map_err(|error| error.to_string())
}
