import type {
  SetsquareElement,
  OrderedSetsquareElement,
} from "@setsquare/element/types";

import type { CaptureUpdateActionType } from "@setsquare/element";

import type {
  AppClassProperties,
  AppState,
  SetsquareProps,
  BinaryFiles,
  UIAppState,
} from "../types";
import type React from "react";

export type ActionSource =
  | "ui"
  | "keyboard"
  | "contextMenu"
  | "api"
  | "commandPalette";

/** if false, the action should be prevented */
export type ActionResult =
  | {
      elements?: readonly SetsquareElement[] | null;
      appState?: Partial<AppState> | null;
      files?: BinaryFiles | null;
      captureUpdate: CaptureUpdateActionType;
      replaceFiles?: boolean;
    }
  | false;

type ActionFn<TData = any> = (
  elements: readonly OrderedSetsquareElement[],
  appState: Readonly<AppState>,
  formData: TData | undefined,
  app: AppClassProperties,
) => ActionResult | Promise<ActionResult>;

export type UpdaterFn = (res: ActionResult) => void;
export type ActionFilterFn = (action: Action) => void;

export type ActionName =
  | "copy"
  | "cut"
  | "paste"
  | "copyAsPng"
  | "copyAsSvg"
  | "copyText"
  | "sendBackward"
  | "bringForward"
  | "sendToBack"
  | "bringToFront"
  | "copyStyles"
  | "selectAll"
  | "pasteStyles"
  | "gridMode"
  | "zenMode"
  | "objectsSnapMode"
  | "arrowBinding"
  | "midpointSnapping"
  | "showHints"
  | "stats"
  | "changeStrokeColor"
  | "changeBackgroundColor"
  | "changeBucketFillBackgroundColor"
  | "changeFillStyle"
  | "changeStrokeWidth"
  | "changeSloppiness"
  | "changeFreedrawMode"
  | "changeStrokeStyle"
  | "changeArrowhead"
  | "changeArrowType"
  | "changeArrowCardinal"
  | "changeArrowProperties"
  | "changeOpacity"
  | "changeFontSize"
  | "undo"
  | "redo"
  | "finalize"
  | "changeProjectName"
  | "changeExportBackground"
  | "changeExportEmbedScene"
  | "changeExportScale"
  | "saveToActiveFile"
  | "saveFileToDisk"
  | "loadScene"
  | "duplicateSelection"
  | "deleteSelectedElements"
  | "changeViewBackgroundColor"
  | "clearCanvas"
  | "zoomIn"
  | "zoomOut"
  | "resetZoom"
  | "zoomToFit"
  | "zoomToFitSelection"
  | "zoomToFitSelectionInViewport"
  | "changeFontFamily"
  | "changeTextAlign"
  | "changeVerticalAlign"
  | "toggleFullScreen"
  | "toggleShortcuts"
  | "group"
  | "ungroup"
  | "goToCollaborator"
  | "addToLibrary"
  | "changeRoundness"
  | "alignTop"
  | "alignBottom"
  | "alignLeft"
  | "alignRight"
  | "alignVerticallyCentered"
  | "alignHorizontallyCentered"
  | "distributeHorizontally"
  | "distributeVertically"
  | "flipHorizontal"
  | "flipVertical"
  | "deselect"
  | "viewMode"
  | "exportWithDarkMode"
  | "toggleTheme"
  | "increaseFontSize"
  | "decreaseFontSize"
  | "unbindText"
  | "hyperlink"
  | "bindText"
  | "unlockAllElements"
  | "toggleElementLock"
  | "toggleLinearEditor"
  | "selectAllElementsInFrame"
  | "removeAllElementsFromFrame"
  | "updateFrameRendering"
  | "createContainerFromText"
  | "wrapTextInContainer"
  | "commandPalette"
  | "autoResize"
  | "elementStats"
  | "searchMenu"
  | "copyElementLink"
  | "linkToElement"
  | "cropEditor"
  | "wrapSelectionInFrame"
  | "toggleWrap"
  | "toggleShapeSwitch"
  | "togglePolygon";

export type PanelComponentProps = {
  elements: readonly SetsquareElement[];
  // UIAppState (not AppState) because PanelComponents only re-render when
  // the UI does — reading UI-stripped props (zoom, scroll, …) would render
  // stale values; subscribe via useAppStateValue for those instead
  appState: UIAppState;
  updateData: <T = any>(formData?: T) => void;
  appProps: SetsquareProps;
  data?: Record<string, any>;
  app: AppClassProperties;
  renderAction: (
    name: ActionName,
    data?: PanelComponentProps["data"],
  ) => React.JSX.Element | null;
};

export interface Action<TData = any> {
  name: ActionName;
  label:
    | string
    | ((
        elements: readonly SetsquareElement[],
        appState: Readonly<UIAppState>,
        app: AppClassProperties,
      ) => string);
  keywords?: string[];
  icon?:
    | React.ReactNode
    | ((
        appState: UIAppState,
        elements: readonly SetsquareElement[],
      ) => React.ReactNode);
  PanelComponent?: React.FC<PanelComponentProps>;
  perform: ActionFn<TData>;
  keyPriority?: number;
  keyTest?: (
    event: React.KeyboardEvent | KeyboardEvent,
    appState: AppState,
    elements: readonly SetsquareElement[],
    app: AppClassProperties,
  ) => boolean;
  predicate?: (
    elements: readonly SetsquareElement[],
    appState: AppState,
    appProps: SetsquareProps,
    app: AppClassProperties,
  ) => boolean;
  checked?: (appState: Readonly<UIAppState>) => boolean;
  /** if set to `true`, allow action to be performed in viewMode.
   *  Defaults to `false` */
  viewMode?: boolean;
  /** if set to `true`, the action counts as canvas navigation and remains
   *  available in the non-interactive editor when
   *  `interaction: { enabled: { navigation: true } }`. Defaults to `false` */
  navigation?: boolean;
}
