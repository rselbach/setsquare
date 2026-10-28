import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import { randomId } from "@setsquare/common";
import { EditorAutomation } from "@setsquare/setsquare/automation/EditorAutomation";
import { automationTools } from "@setsquare/setsquare/automation/schema";
import { useApp } from "@setsquare/setsquare/components/App";
import { Dialog } from "@setsquare/setsquare/components/Dialog";
import { loadFromBlob } from "@setsquare/setsquare/data/blob";
import { useI18n } from "@setsquare/setsquare/i18n";

import { LocalData } from "../data/LocalData";

import { DesktopFileHandle } from "./fileSystem";

import "./AgentAccess.scss";

type Connection = { url: string; token: string; connectionFile: string };
type Request =
  | { kind: "call"; id: string; name: string; args: unknown; deadline: number }
  | { kind: "cancel"; id: string };

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const AgentAccess = ({
  open,
  onClose,
}: {
  open: boolean;
  onClose(): void;
}) => {
  const app = useApp();
  const { t } = useI18n();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }
    const registration = randomId();
    const controllers = new Map<string, AbortController>();
    let disposed = false;
    const automation = new EditorAutomation(app.api, app.ownerDocument, {
      async persist() {
        await LocalData.flushSave();
        await LocalData.saveImmediately(
          app.api.getSceneElements(),
          app.api.getAppState(),
          app.api.getFiles(),
        );
      },
      async open(path, id) {
        const contents = await invoke<string>("mcp_read_document", { id });
        const blob = new app.ownerWindow.Blob([contents], {
          type: "application/json",
        });
        return loadFromBlob(blob, null, null, new DesktopFileHandle(path));
      },
      async save(path, contents, _overwrite, id) {
        await invoke("mcp_write_document", { id, contents });
        return new DesktopFileHandle(path);
      },
    });
    const channel = new Channel<Request>();
    channel.onmessage = (request) => {
      if (request.kind === "cancel") {
        controllers.get(request.id)?.abort();
        return;
      }
      const controller = new app.ownerWindow.AbortController();
      controllers.set(request.id, controller);
      const assertActive = () => {
        controller.signal.throwIfAborted();
        if (disposed || Date.now() > request.deadline) {
          throw new Error("Editor request expired");
        }
      };
      (async () => {
        try {
          const reply = await automation.execute(
            request.name,
            request.args,
            assertActive,
            request.id,
          );
          await invoke("mcp_reply", { registration, id: request.id, reply });
        } catch (error) {
          await invoke("mcp_reply", {
            registration,
            id: request.id,
            reply: { kind: "error", message: errorMessage(error) },
          });
        } finally {
          controllers.delete(request.id);
        }
      })().catch((error) => {
        if (!disposed && !controller.signal.aborted) {
          console.error("Couldn't return editor command result", error);
        }
      });
    };
    const registered = invoke("mcp_register", {
      registration,
      channel,
      tools: automationTools,
    });
    registered
      .then(() => invoke<Connection | null>("mcp_status"))
      .then((connection) => {
        if (!disposed) {
          setConnection(connection);
        }
      })
      .catch((error) => setError(errorMessage(error)));
    return () => {
      disposed = true;
      controllers.forEach((controller) => controller.abort());
      registered
        .then(() => invoke("mcp_unregister", { registration }))
        .catch((error) => console.error("Couldn't detach agent access", error));
    };
  }, [app]);

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      if (connection) {
        await invoke("mcp_stop");
        setConnection(null);
        return;
      }
      setConnection(await invoke<Connection>("mcp_start"));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return null;
  }
  return (
    <Dialog
      title={t("agentAccess.title")}
      size="small"
      onCloseRequest={onClose}
    >
      <div className="agent-access">
        <p>{t("agentAccess.description")}</p>
        <button type="button" disabled={busy} onClick={toggle}>
          {connection ? t("agentAccess.disable") : t("agentAccess.enable")}
        </button>
        {connection && (
          <>
            <label>
              {t("agentAccess.url")}
              <input
                readOnly
                value={connection.url}
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
            <label>
              {t("agentAccess.token")}
              <input
                readOnly
                type="password"
                value={connection.token}
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
            <button
              type="button"
              onClick={async () => {
                try {
                  await app.ownerWindow.navigator.clipboard.writeText(
                    JSON.stringify(
                      {
                        url: connection.url,
                        headers: {
                          Authorization: `Bearer ${connection.token}`,
                        },
                      },
                      null,
                      2,
                    ),
                  );
                } catch (error) {
                  setError(errorMessage(error));
                }
              }}
            >
              {t("agentAccess.copy")}
            </button>
            <p>
              {t("agentAccess.session")}{" "}
              <code>{connection.connectionFile}</code>
            </p>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </Dialog>
  );
};
