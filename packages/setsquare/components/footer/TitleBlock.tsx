import clsx from "clsx";
import { useEffect, useState } from "react";

import { KEYS, focusNearestParent } from "@setsquare/common";

import { actionChangeProjectName, actionShortcuts } from "../../actions";
import { t } from "../../i18n";
import { ZoomActions } from "../Actions";
import { HelpButton } from "../HelpButton";

import "./TitleBlock.scss";

import type { ActionManager } from "../../actions/manager";
import type { UIAppState } from "../../types";

const DrawingName = ({
  name,
  readOnly,
  actionManager,
}: {
  name: UIAppState["name"];
  readOnly: boolean;
  actionManager: ActionManager;
}) => {
  const [value, setValue] = useState(name ?? "");

  useEffect(() => {
    setValue(name ?? "");
  }, [name]);

  return (
    <input
      type="text"
      className="TitleBlock__name"
      value={value}
      placeholder={t("labels.untitled")}
      aria-label={t("labels.fileTitle")}
      readOnly={readOnly}
      spellCheck={false}
      onChange={(event) => setValue(event.target.value)}
      onBlur={(event) => {
        focusNearestParent(event.target);
        if (value !== (name ?? "")) {
          actionManager.executeAction(actionChangeProjectName, "ui", value);
        }
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) {
          return;
        }
        if (event.key === KEYS.ESCAPE) {
          setValue(name ?? "");
          // blur after the reset renders, so blur doesn't save the edit
          const input = event.currentTarget;
          requestAnimationFrame(() => input.blur());
        } else if (event.key === KEYS.ENTER) {
          event.currentTarget.blur();
        }
      }}
    />
  );
};

/**
 * The drawing's title block, ruled into cells like the one in the corner of
 * an engineering drawing: the drawing name, the zoom and help.
 */
export const TitleBlock = ({
  appState,
  actionManager,
  showName,
  showZoom,
  showHelp,
}: {
  appState: UIAppState;
  actionManager: ActionManager;
  showName: boolean;
  showZoom: boolean;
  showHelp: boolean;
}) => {
  if (!showName && !showZoom && !showHelp) {
    return null;
  }

  return (
    <div
      className={clsx("TitleBlock", {
        "TitleBlock--zen": appState.zenModeEnabled,
      })}
    >
      {showName && (
        <div
          className={clsx(
            "TitleBlock__cell TitleBlock__cell--name zen-mode-transition",
            { "transition-right": appState.zenModeEnabled },
          )}
        >
          <DrawingName
            name={appState.name}
            readOnly={appState.viewModeEnabled}
            actionManager={actionManager}
          />
        </div>
      )}
      {showZoom && (
        <div className="TitleBlock__cell TitleBlock__cell--zoom">
          <ZoomActions renderAction={actionManager.renderAction} />
        </div>
      )}
      {showHelp && (
        <div
          className={clsx(
            "TitleBlock__cell TitleBlock__cell--help zen-mode-transition",
            { "transition-right": appState.zenModeEnabled },
          )}
        >
          <HelpButton
            onClick={() => actionManager.executeAction(actionShortcuts)}
          />
        </div>
      )}
    </div>
  );
};
