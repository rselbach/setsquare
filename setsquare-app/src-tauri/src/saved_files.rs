//! Saves drawings without ever leaving a file half written.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::Path;

use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Url};
use tauri_plugin_fs::FsExt;

/// Replaces the file named by the request's `url` header with the request's
/// body. The editor may only save files the user picked or opened.
#[tauri::command]
pub fn save_file(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let path = request
        .headers()
        .get("url")
        .and_then(|url| url.to_str().ok())
        .and_then(|url| Url::parse(url).ok())
        .and_then(|url| url.to_file_path().ok())
        .ok_or("missing file URL")?;
    if !app.fs_scope().is_allowed(&path) {
        return Err(format!("not allowed to save {}", path.display()));
    }
    let InvokeBody::Raw(contents) = request.body() else {
        return Err("missing file contents".into());
    };
    replace(&path, contents).map_err(|error| error.to_string())
}

/// Writes the contents to a temporary file next to the file, then moves it
/// into the file's place, so a failed write leaves the file as it was.
fn replace(path: &Path, contents: &[u8]) -> io::Result<()> {
    // saving through a symlink replaces the file it points to
    let path = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let name = path
        .file_name()
        .ok_or_else(|| io::Error::other("not a file"))?
        .to_string_lossy();
    let temporary = path.with_file_name(format!(".{name}.{}.tmp", std::process::id()));

    let result = write(&temporary, &path, contents).and_then(|()| fs::rename(&temporary, &path));
    if result.is_err() {
        if let Err(error) = fs::remove_file(&temporary) {
            eprintln!("failed to remove {}: {error}", temporary.display());
        }
    }
    result
}

fn write(temporary: &Path, path: &Path, contents: &[u8]) -> io::Result<()> {
    let mut file = File::create(temporary)?;
    // the replacement keeps the file's permissions
    if let Ok(metadata) = fs::metadata(path) {
        file.set_permissions(metadata.permissions())?;
    }
    file.write_all(contents)?;
    file.sync_all()
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt;

    use super::*;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("setsquare-{name}-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn replaces_the_file_and_keeps_its_permissions() {
        let dir = scratch("replace");
        let path = dir.join("greendale.setsquare");
        fs::write(&path, "troy").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();

        replace(&path, b"abed").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "abed");
        let mode = fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn leaves_the_file_alone_when_writing_fails() {
        let dir = scratch("fail");
        let path = dir.join("greendale.setsquare");
        fs::write(&path, "troy").unwrap();
        // a directory where the temporary file would go makes writing fail
        let temporary = dir.join(format!(".greendale.setsquare.{}.tmp", std::process::id()));
        fs::create_dir(&temporary).unwrap();

        assert!(replace(&path, b"abed").is_err());

        assert_eq!(fs::read_to_string(&path).unwrap(), "troy");
        fs::remove_dir_all(dir).unwrap();
    }
}
