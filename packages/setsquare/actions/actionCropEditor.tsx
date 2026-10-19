import { isImageElement } from "@setsquare/element";

import { CaptureUpdateAction } from "@setsquare/element";

import type { SetsquareImageElement } from "@setsquare/element/types";

import { IconButton } from "../components/IconButton";
import { cropIcon } from "../components/icons";
import { t } from "../i18n";

import { register } from "./register";

export const actionToggleCropEditor = register({
  name: "cropEditor",
  label: "helpDialog.cropStart",
  icon: cropIcon,
  viewMode: true,
  trackEvent: { category: "menu" },
  keywords: ["image", "crop"],
  perform(elements, appState, _, app) {
    const selectedElement = app.scene.getSelectedElements({
      selectedElementIds: appState.selectedElementIds,
      includeBoundTextElement: true,
    })[0] as SetsquareImageElement;

    return {
      appState: {
        ...appState,
        isCropping: false,
        croppingElementId: selectedElement.id,
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  predicate: (elements, appState, _, app) => {
    const selectedElements = app.scene.getSelectedElements(appState);
    if (
      !appState.croppingElementId &&
      selectedElements.length === 1 &&
      isImageElement(selectedElements[0])
    ) {
      return true;
    }
    return false;
  },
  PanelComponent: ({ appState, updateData, app }) => {
    const label = t("helpDialog.cropStart");

    return (
      <IconButton
        type="button"
        icon={cropIcon}
        title={label}
        aria-label={label}
        onClick={() => updateData(null)}
      />
    );
  },
});
