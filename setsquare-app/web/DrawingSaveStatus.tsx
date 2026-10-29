import { t } from "@setsquare/setsquare/i18n";
import { useState, useSyncExternalStore } from "react";

import { navigate } from "./router";

import "./DrawingSaveStatus.scss";

import type {
  DrawingPersistence,
  DrawingSaveState,
} from "./drawingPersistence";

const messageFor = (state: DrawingSaveState) => {
  switch (state.kind) {
    case "saved":
      return t("workspace.saveSaved");
    case "saving":
      return t("workspace.saveSaving");
    case "unsaved":
      return t("workspace.saveSaving");
    case "expired":
      return t("workspace.saveSessionExpired");
    case "conflict":
    case "missing":
      return t("workspace.saveConflict");
    case "error":
      return t("workspace.saveFailed");
  }
};

/** The server acknowledgement and recovery actions for the current drawing. */
export const DrawingSaveStatus = ({
  persistence,
}: {
  persistence: DrawingPersistence;
}) => {
  const state = useSyncExternalStore(
    persistence.subscribeSaveState,
    persistence.getSaveState,
  );
  const [copying, setCopying] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const canCopy = state.kind === "conflict" || state.kind === "missing";
  const recoveryFailed = persistence.getRecoveryError() !== null;
  const copy = async () => {
    setCopying(true);
    setCopyFailed(false);
    try {
      const drawing = await persistence.recoverAsCopy();
      if (drawing) {
        await navigate({ kind: "drawing", id: drawing.id });
      }
    } catch (error) {
      console.error(error);
      setCopyFailed(true);
    } finally {
      setCopying(false);
    }
  };

  return (
    <div
      className="drawing-save-status"
      data-state={state.kind}
      role="status"
      aria-live="polite"
    >
      <span>
        {recoveryFailed
          ? t("workspace.recoveryFailed")
          : copyFailed
          ? t("workspace.saveCopyFailed")
          : messageFor(state)}
      </span>
      {recoveryFailed && (
        <button type="button" onClick={() => persistence.exportRecovery()}>
          {t("workspace.exportRecovery")}
        </button>
      )}
      {canCopy && (
        <button type="button" onClick={copy} disabled={copying}>
          {t("workspace.saveCopy")}
        </button>
      )}
      {state.kind === "error" && (
        <button type="button" onClick={() => persistence.retry()}>
          {t("workspace.saveRetry")}
        </button>
      )}
    </div>
  );
};
