use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rmcp::model::Tool;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::ipc::Channel;
use tokio::sync::{oneshot, Mutex as AsyncMutex};
use uuid::Uuid;

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Request {
    Call {
        id: String,
        name: String,
        args: Value,
        deadline: u64,
    },
    Cancel {
        id: String,
    },
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Reply {
    Json {
        data: Value,
    },
    Image {
        data: String,
        #[serde(rename = "documentId")]
        document_id: String,
        revision: u64,
    },
    Error {
        message: String,
    },
}

pub struct Pending {
    pub name: String,
    pub args: Value,
    sender: oneshot::Sender<Reply>,
}

#[derive(Default)]
pub struct Editor {
    pub registration: String,
    pub channel: Option<Channel<Request>>,
    pub tools: Vec<Tool>,
    pub pending: HashMap<String, Pending>,
}

#[derive(Clone, Default)]
pub struct Bridge {
    pub editor: Arc<Mutex<Editor>>,
    pub gate: Arc<AsyncMutex<()>>,
}

impl Bridge {
    pub fn lock(&self) -> std::sync::MutexGuard<'_, Editor> {
        self.editor.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn cancel_pending(&self) {
        let mut editor = self.lock();
        for (id, _) in editor.pending.drain().collect::<Vec<_>>() {
            if let Some(channel) = &editor.channel {
                if let Err(error) = channel.send(Request::Cancel { id }) {
                    eprintln!("couldn't cancel editor command: {error}");
                }
            }
        }
    }

    pub async fn call(&self, name: String, args: Value) -> Result<Reply, String> {
        let _gate = self.gate.lock().await;
        let id = Uuid::new_v4().to_string();
        let (sender, receiver) = oneshot::channel();
        let deadline = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_millis() as u64
            + 55_000;
        {
            let mut editor = self.lock();
            let channel = editor.channel.clone().ok_or("Editor is not ready")?;
            if !editor.tools.iter().any(|tool| tool.name == name) {
                return Err(format!("Unknown tool: {name}"));
            }
            editor.pending.insert(
                id.clone(),
                Pending {
                    name: name.clone(),
                    args: args.clone(),
                    sender,
                },
            );
            if let Err(error) = channel.send(Request::Call {
                id: id.clone(),
                name,
                args,
                deadline,
            }) {
                editor.pending.remove(&id);
                return Err(format!("Editor is unavailable: {error}"));
            }
        }
        let _pending = PendingGuard {
            bridge: self.clone(),
            id,
        };
        tokio::time::timeout(Duration::from_secs(60), receiver)
            .await
            .map_err(|_| {
                "Editor request timed out. Read the document or retry with the same requestId."
                    .to_string()
            })?
            .map_err(|_| "Editor disconnected or agent access was disabled".to_string())
    }

    pub fn reply(&self, registration: &str, id: &str, reply: Reply) -> Result<(), String> {
        let mut editor = self.lock();
        if editor.registration != registration {
            return Err("Editor registration expired".into());
        }
        if let Some(pending) = editor.pending.remove(id) {
            // a cancelled HTTP request may no longer have a receiver
            if pending.sender.send(reply).is_err() {
                return Err("Request was cancelled".into());
            }
        }
        Ok(())
    }
}

struct PendingGuard {
    bridge: Bridge,
    id: String,
}

impl Drop for PendingGuard {
    fn drop(&mut self) {
        let mut editor = self.bridge.lock();
        if editor.pending.remove(&self.id).is_some() {
            if let Some(channel) = &editor.channel {
                if let Err(error) = channel.send(Request::Cancel {
                    id: self.id.clone(),
                }) {
                    eprintln!("couldn't cancel editor command: {error}");
                }
            }
        }
    }
}
