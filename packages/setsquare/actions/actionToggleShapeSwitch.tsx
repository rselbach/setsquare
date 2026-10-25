import { CaptureUpdateAction } from "@setsquare/element";

import type { SetsquareElement } from "@setsquare/element/types";

import {
  getConversionTypeFromElements,
  convertElementTypePopupAtom,
} from "../components/ConvertElementTypePopup";
import { editorJotaiStore } from "../editor-jotai";

import { register } from "./register";

export const actionToggleShapeSwitch = register({
  name: "toggleShapeSwitch",
  label: "labels.shapeSwitch",
  icon: () => null,
  viewMode: true,
  keywords: ["change", "switch", "swap"],
  perform(elements, appState, _, app) {
    editorJotaiStore.set(convertElementTypePopupAtom, {
      type: "panel",
    });

    return {
      captureUpdate: CaptureUpdateAction.NEVER,
    };
  },
  checked: (appState) => appState.gridModeEnabled,
  predicate: (elements, appState, props) =>
    getConversionTypeFromElements(elements as SetsquareElement[]) !== null,
});
