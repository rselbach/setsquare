import { AppWelcomeScreen } from "../components/AppWelcomeScreen";
import { EditorShell } from "../editor/EditorShell";
import { useHandleAppTheme } from "../useHandleAppTheme";

import { DesktopMenu } from "./DesktopMenu";
import { useSceneUrlLinks } from "./sceneUrl";
import { singleScenePersistence } from "./singleScenePersistence";

/** The editor on the one scene the app keeps. */
export const SingleSceneRoot = () => {
  const { editorTheme, appTheme, setAppTheme } = useHandleAppTheme();

  useSceneUrlLinks();

  return (
    <EditorShell
      persistence={singleScenePersistence}
      theme={editorTheme}
      onThemeChange={setAppTheme}
    >
      <DesktopMenu theme={appTheme} setTheme={setAppTheme} />
      <AppWelcomeScreen />
    </EditorShell>
  );
};
