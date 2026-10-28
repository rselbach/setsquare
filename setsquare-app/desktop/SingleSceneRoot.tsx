import { isTauri } from "@tauri-apps/api/core";
import { useState } from "react";

import { AppMainMenu } from "../components/AppMainMenu";
import { AppWelcomeScreen } from "../components/AppWelcomeScreen";
import { EditorShell } from "../editor/EditorShell";
import { useHandleAppTheme } from "../useHandleAppTheme";

import { DesktopMenu } from "./DesktopMenu";
import { useSceneUrlLinks } from "./sceneUrl";
import { singleScenePersistence } from "./singleScenePersistence";

/** The editor on the one scene the app keeps. */
export const SingleSceneRoot = () => {
  const { editorTheme, appTheme, setAppTheme } = useHandleAppTheme();

  const [, forceRefresh] = useState(false);

  useSceneUrlLinks();

  return (
    <EditorShell
      persistence={singleScenePersistence}
      theme={editorTheme}
      onThemeChange={setAppTheme}
    >
      {isTauri() ? (
        <DesktopMenu theme={appTheme} setTheme={setAppTheme} />
      ) : (
        <AppMainMenu
          theme={appTheme}
          refresh={() => forceRefresh((prev) => !prev)}
        />
      )}
      <AppWelcomeScreen />
    </EditorShell>
  );
};
