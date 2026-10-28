//! Local MCP access to the mounted editor. Diagram semantics live in TypeScript.

mod bridge;
pub mod files;
mod server;

use std::{fs, path::PathBuf};

use rmcp::model::Tool;
use serde::Serialize;
use tauri::{ipc::Channel, AppHandle, Manager, State};
use tokio::{net::TcpListener, sync::Mutex};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use bridge::{Bridge, Reply, Request};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    url: String,
    token: String,
    connection_file: PathBuf,
}

struct RunningServer {
    connection: Connection,
    cancellation: CancellationToken,
}

impl Drop for RunningServer {
    fn drop(&mut self) {
        self.cancellation.cancel();
        if let Err(error) = fs::remove_file(&self.connection.connection_file) {
            if error.kind() != std::io::ErrorKind::NotFound {
                eprintln!("couldn't remove MCP connection file: {error}");
            }
        }
    }
}

#[derive(Default)]
pub struct McpState {
    bridge: Bridge,
    server: Mutex<Option<RunningServer>>,
}

#[tauri::command]
pub fn mcp_register(
    state: State<McpState>,
    registration: String,
    channel: Channel<Request>,
    tools: Vec<Tool>,
) {
    state.bridge.cancel_pending();
    let mut editor = state.bridge.lock();
    editor.registration = registration;
    editor.channel = Some(channel);
    editor.tools = tools;
}

#[tauri::command]
pub fn mcp_unregister(state: State<McpState>, registration: String) {
    if state.bridge.lock().registration != registration {
        return;
    }
    state.bridge.cancel_pending();
    let mut editor = state.bridge.lock();
    editor.channel = None;
    editor.tools.clear();
}

#[tauri::command]
pub fn mcp_reply(
    state: State<McpState>,
    registration: String,
    id: String,
    reply: Reply,
) -> Result<(), String> {
    state.bridge.reply(&registration, &id, reply)
}

#[tauri::command]
pub async fn mcp_status(state: State<'_, McpState>) -> Result<Option<Connection>, String> {
    Ok(state
        .server
        .lock()
        .await
        .as_ref()
        .map(|server| server.connection.clone()))
}

#[tauri::command]
pub async fn mcp_start(app: AppHandle, state: State<'_, McpState>) -> Result<Connection, String> {
    let mut running = state.server.lock().await;
    if let Some(server) = running.as_ref() {
        return Ok(server.connection.clone());
    }
    if state.bridge.lock().channel.is_none() {
        return Err("Editor is not ready".into());
    }
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| error.to_string())?;
    let address = listener.local_addr().map_err(|error| error.to_string())?;
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let connection = Connection {
        url: format!("http://{address}/mcp"),
        token: format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple()),
        connection_file: directory.join("mcp-connection.json"),
    };
    write_connection(&connection)?;
    let cancellation = CancellationToken::new();
    let router = server::router(
        state.bridge.clone(),
        &connection.token,
        cancellation.clone(),
    );
    let shutdown = cancellation.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = axum::serve(listener, router)
            .with_graceful_shutdown(shutdown.cancelled_owned())
            .await
        {
            eprintln!("MCP server stopped: {error}");
        }
    });
    *running = Some(RunningServer {
        connection: connection.clone(),
        cancellation,
    });
    Ok(connection)
}

fn write_connection(connection: &Connection) -> Result<(), String> {
    use std::io::Write;
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&connection.connection_file)
        .map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }
    file.write_all(&serde_json::to_vec_pretty(connection).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn mcp_stop(state: State<'_, McpState>) -> Result<(), String> {
    state.server.lock().await.take();
    state.bridge.cancel_pending();
    Ok(())
}

pub fn shutdown(app: &AppHandle) {
    let state = app.state::<McpState>();
    if let Ok(mut running) = state.server.try_lock() {
        running.take();
    }
    state.bridge.cancel_pending();
}
