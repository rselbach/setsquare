import { getShortcutFromShortcutName } from "@setsquare/setsquare/actions/shortcuts";
import { LoadIcon, eyeIcon } from "@setsquare/setsquare/components/icons";
import { useI18n } from "@setsquare/setsquare/i18n";
import { MainMenu } from "@setsquare/setsquare/index";
import React from "react";

import { isDevEnv } from "@setsquare/common";

import type { Theme } from "@setsquare/element/types";

import { LanguageList } from "../app-language/LanguageList";
import { newDrawingIcon } from "../web/icons";

import { saveDebugState } from "./DebugCanvas";

import type { WorkspaceActions } from "../web/workspaceActions";

/** The web app's main menu; the desktop app has its menu bar instead. */
export const AppMainMenu: React.FC<{
  theme: Theme | "system";
  refresh: () => void;
  actions: WorkspaceActions;
}> = React.memo((props) => {
  const { t } = useI18n();
  return (
    <MainMenu>
      <MainMenu.Item icon={newDrawingIcon} onSelect={props.actions.newDrawing}>
        {t("workspace.newDrawing")}
      </MainMenu.Item>
      <MainMenu.Item
        icon={LoadIcon}
        onSelect={props.actions.openFile}
        shortcut={getShortcutFromShortcutName("loadScene")}
      >
        {t("workspace.openFile")}
      </MainMenu.Item>
      <MainMenu.DefaultItems.SaveToActiveFile />
      <MainMenu.DefaultItems.Export />
      <MainMenu.DefaultItems.SaveAsImage />
      <MainMenu.DefaultItems.CommandPalette className="highlighted" />
      <MainMenu.DefaultItems.SearchMenu />
      <MainMenu.DefaultItems.Help />
      <MainMenu.DefaultItems.ClearCanvas />
      {isDevEnv() && (
        <MainMenu.Item
          icon={eyeIcon}
          onSelect={() => {
            if (window.visualDebug) {
              delete window.visualDebug;
              saveDebugState({ enabled: false });
            } else {
              window.visualDebug = { data: [] };
              saveDebugState({ enabled: true });
            }
            props?.refresh();
          }}
        >
          Visual Debug
        </MainMenu.Item>
      )}
      <MainMenu.Separator />
      <MainMenu.DefaultItems.Preferences />
      <MainMenu.DefaultItems.ToggleTheme allowSystemTheme theme={props.theme} />
      <MainMenu.ItemCustom>
        <LanguageList style={{ width: "100%" }} />
      </MainMenu.ItemCustom>
      <MainMenu.DefaultItems.ChangeCanvasBackground />
    </MainMenu>
  );
});
