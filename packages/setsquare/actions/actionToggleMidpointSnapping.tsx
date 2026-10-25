import { CaptureUpdateAction } from "@setsquare/element";

import { register } from "./register";

export const actionToggleMidpointSnapping = register({
  name: "midpointSnapping",
  label: "labels.midpointSnapping",
  viewMode: false,
  perform(elements, appState) {
    return {
      appState: {
        ...appState,
        isMidpointSnappingEnabled: !this.checked!(appState),
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    };
  },
  checked: (appState) => appState.isMidpointSnappingEnabled,
});
