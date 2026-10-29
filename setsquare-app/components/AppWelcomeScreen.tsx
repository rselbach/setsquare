import { isTauri } from "@tauri-apps/api/core";
import { getShortcutFromShortcutName } from "@setsquare/setsquare/actions/shortcuts";
import { LoadIcon } from "@setsquare/setsquare/components/icons";
import { useI18n } from "@setsquare/setsquare/i18n";
import { WelcomeScreen } from "@setsquare/setsquare/index";
import React from "react";

import { newDrawingIcon } from "../web/icons";

import type { WorkspaceActions } from "../web/workspaceActions";

/**
 * The welcome screen of an empty drawing. With the workspace's actions, it
 * offers to start or open another drawing; without, to open a file over
 * this one.
 */
export const AppWelcomeScreen: React.FC<{
  actions?: WorkspaceActions;
}> = React.memo(({ actions }) => {
  const { t } = useI18n();

  return (
    <WelcomeScreen>
      {/* the desktop app keeps these in the menu bar instead of a main menu */}
      {!isTauri() && (
        <WelcomeScreen.Hints.MenuHint>
          {t("welcomeScreen.app.menuHint")}
        </WelcomeScreen.Hints.MenuHint>
      )}
      <WelcomeScreen.Hints.HelpHint />
      <WelcomeScreen.Center>
        <WelcomeScreen.Center.Logo>
          <svg
            viewBox="0 0 22 22"
            width="1em"
            height="1em"
            fill="currentColor"
            aria-hidden="true"
          >
            <path fillRule="evenodd" d="M3 19V3l16 16zm3-3h6.4L6 9.6z" />
          </svg>
          Setsquare
        </WelcomeScreen.Center.Logo>
        <WelcomeScreen.Center.Heading>
          {isTauri() ? (
            t("welcomeScreen.app.center_heading_desktop")
          ) : (
            <>
              {t("welcomeScreen.app.center_heading")}
              <br />
              {t("welcomeScreen.app.center_heading_line2")}
            </>
          )}
          <br />
          {t("welcomeScreen.app.center_heading_line3")}
        </WelcomeScreen.Center.Heading>
        <WelcomeScreen.Center.Menu>
          {actions ? (
            <>
              <WelcomeScreen.Center.MenuItem
                icon={newDrawingIcon}
                onSelect={actions.newDrawing}
              >
                {t("workspace.newDrawing")}
              </WelcomeScreen.Center.MenuItem>
              <WelcomeScreen.Center.MenuItem
                icon={LoadIcon}
                onSelect={actions.openFile}
                shortcut={getShortcutFromShortcutName("loadScene")}
              >
                {t("workspace.openFile")}
              </WelcomeScreen.Center.MenuItem>
            </>
          ) : (
            <WelcomeScreen.Center.MenuItemLoadScene />
          )}
          <WelcomeScreen.Center.MenuItemHelp />
        </WelcomeScreen.Center.Menu>
      </WelcomeScreen.Center>
    </WelcomeScreen>
  );
});
