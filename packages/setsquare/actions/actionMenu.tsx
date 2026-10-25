import { KEYS } from "@setsquare/common";

import { CaptureUpdateAction } from "@setsquare/element";

import { HelpIconThin } from "../components/icons";

import { register } from "./register";

export const actionShortcuts = register({
  name: "toggleShortcuts",
  label: "welcomeScreen.defaults.helpHint",
  icon: HelpIconThin,
  viewMode: true,
  perform: (_elements, appState, _, { focusContainer }) => {
    if (appState.openDialog?.name === "help") {
      focusContainer();
    }
    return {
      appState: {
        ...appState,
        openDialog:
          appState.openDialog?.name === "help"
            ? null
            : {
                name: "help",
              },
        openMenu: null,
        openPopup: null,
      },
      captureUpdate: CaptureUpdateAction.EVENTUALLY,
    };
  },
  keyTest: (event) => event.key === KEYS.QUESTION_MARK,
});
