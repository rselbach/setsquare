import type { UIAppState } from "@setsquare/setsquare/types";

import { getSelectedElements } from "./selection";

import type { NonDeletedSetsquareElement } from "./types";

export const showSelectedShapeActions = (
  appState: UIAppState,
  elements: readonly NonDeletedSetsquareElement[],
) =>
  Boolean(
    !appState.viewModeEnabled &&
    appState.openDialog?.name !== "elementLinkSelector" &&
    ((appState.activeTool.type !== "custom" &&
      (appState.editingTextElement ||
        (appState.activeTool.type !== "selection" &&
          appState.activeTool.type !== "lasso" &&
          appState.activeTool.type !== "eraser" &&
          appState.activeTool.type !== "hand" &&
          appState.activeTool.type !== "laser"))) ||
      getSelectedElements(elements, appState).length),
  );
