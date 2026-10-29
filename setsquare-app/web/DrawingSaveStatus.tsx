import { useEditorInterface } from "@setsquare/setsquare";
import { t } from "@setsquare/setsquare/i18n";
import { Footer } from "@setsquare/setsquare/index";
import clsx from "clsx";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { navigate } from "./router";

import "./DrawingSaveStatus.scss";

import type {
  DrawingPersistence,
  DrawingSaveState,
} from "./drawingPersistence";

// a failed save tries again on its own, backing off while it keeps failing
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

type Status = {
  tone: "quiet" | "warning" | "danger";
  label: string;
  detail?: string;
};

const statusFor = (state: DrawingSaveState): Status => {
  switch (state.kind) {
    case "saved":
      return { tone: "quiet", label: t("workspace.saveSaved") };
    case "saving":
    case "unsaved":
      return { tone: "quiet", label: t("workspace.saveSaving") };
    case "error":
      return {
        tone: "danger",
        label: t("workspace.saveNotSaved"),
        detail: t("workspace.saveFailed"),
      };
    // the account notice says why, and signs in again
    case "expired":
      return { tone: "danger", label: t("workspace.saveNotSaved") };
    case "conflict":
      return {
        tone: "warning",
        label: t("workspace.saveChangedElsewhere"),
        detail: t("workspace.saveConflict"),
      };
    case "missing":
      return {
        tone: "warning",
        label: t("workspace.saveChangedElsewhere"),
        detail: t("workspace.saveMissing"),
      };
  }
};

/**
 * Whether the server has the drawing, beside its title, and what to do when
 * it doesn't. Phones, which have no footer, only show it when it's a problem.
 */
export const DrawingSaveStatus = ({
  persistence,
}: {
  persistence: DrawingPersistence;
}) => {
  const isPhone = useEditorInterface().formFactor === "phone";
  const state = useSyncExternalStore(
    persistence.subscribeSaveState,
    persistence.getSaveState,
  );
  const [copying, setCopying] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const failures = useRef(0);

  useEffect(() => {
    if (state.kind !== "error") {
      if (state.kind === "saved") {
        failures.current = 0;
      }
      return;
    }
    const retry = () => {
      persistence.retry().catch((error) => console.error(error));
    };
    const timer = window.setTimeout(
      retry,
      RETRY_DELAYS_MS[Math.min(failures.current, RETRY_DELAYS_MS.length - 1)],
    );
    failures.current++;
    window.addEventListener("online", retry);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("online", retry);
    };
  }, [state.kind, persistence]);

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

  let status = statusFor(state);
  let action: { label: string; run: () => void } | null = null;
  if (persistence.getRecoveryError() !== null) {
    status = {
      tone: "danger",
      label: t("workspace.saveNotSaved"),
      detail: t("workspace.recoveryFailed"),
    };
    action = {
      label: t("workspace.exportRecovery"),
      run: () => persistence.exportRecovery(),
    };
  } else if (state.kind === "conflict" || state.kind === "missing") {
    if (copyFailed) {
      status = { ...status, detail: t("workspace.saveCopyFailed") };
    }
    action = { label: t("workspace.saveCopy"), run: copy };
  } else if (state.kind === "error") {
    action = {
      label: t("workspace.saveRetry"),
      run: () => {
        persistence.retry().catch((error) => console.error(error));
      },
    };
  }
  if (isPhone && status.tone === "quiet") {
    return null;
  }

  const box = (
    <div
      className={clsx(
        "drawing-save-status",
        `drawing-save-status--${status.tone}`,
        { "drawing-save-status--floating": isPhone },
      )}
      data-state={state.kind}
      role="status"
      aria-live="polite"
    >
      <span className="drawing-save-status__label">{status.label}</span>
      {status.detail && (
        <span className="drawing-save-status__detail">{status.detail}</span>
      )}
      {action && (
        <button
          type="button"
          className="drawing-save-status__action"
          onClick={action.run}
          disabled={copying}
        >
          {action.label}
        </button>
      )}
    </div>
  );
  return isPhone ? box : <Footer>{box}</Footer>;
};
