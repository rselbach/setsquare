import type { UserIdleState, EditorInterface } from "@setsquare/common";
import type {
  SetsquareElement,
  NonDeletedElementsMap,
  NonDeletedSetsquareElement,
  NonDeletedSceneElementsMap,
} from "@setsquare/element/types";

import type { MakeBrand } from "@setsquare/common/utility-types";
import type { LinkDirection } from "@setsquare/element";
import type { GlobalPoint } from "@setsquare/math";

import type {
  AppClassProperties,
  AppState,
  EmbedsValidationStatus,
  ElementRenderOverrides,
  ElementsPendingErasure,
  InteractiveCanvasAppState,
  StaticCanvasAppState,
  SocketId,
  PendingSetsquareElements,
} from "../types";
import type { RoughCanvas } from "roughjs/bin/canvas";
import type { Drawable } from "roughjs/bin/core";

export type RenderableElementsMap = NonDeletedElementsMap &
  MakeBrand<"RenderableElementsMap">;

export type StaticCanvasRenderConfig = {
  canvasBackgroundColor: AppState["viewBackgroundColor"];
  // extra options passed to the renderer
  // ---------------------------------------------------------------------------
  imageCache: AppClassProperties["imageCache"];
  renderGrid: boolean;
  /** whether to render link icons on elements with links (never rendered
   when exporting). @default true */
  renderLinks?: boolean;
  /** when exporting the behavior is slightly different (e.g. we can't use
   CSS filters), and we disable render optimizations for best output */
  isExporting: boolean;
  embedsValidationStatus: EmbedsValidationStatus;
  elementsPendingErasure: ElementsPendingErasure;
  pendingFlowchartNodes: PendingSetsquareElements | null;
  theme: AppState["theme"];
  elementRenderOverrides?: ElementRenderOverrides;
};

export type SVGRenderConfig = {
  offsetX: number;
  offsetY: number;
  isExporting: boolean;
  exportWithDarkMode: boolean;
  renderEmbeddables: boolean;
  frameRendering: AppState["frameRendering"];
  canvasBackgroundColor: AppState["viewBackgroundColor"];
  embedsValidationStatus: EmbedsValidationStatus;
  /**
   * whether to attempt to reuse images as much as possible through symbols
   * (reduces SVG size, but may be incompoatible with some SVG renderers)
   *
   * @default true
   */
  reuseImages: boolean;
  theme: AppState["theme"];
};

export type InteractiveCanvasRenderConfig = {
  // collab-related state
  // ---------------------------------------------------------------------------
  remoteSelectedElementIds: Map<SetsquareElement["id"], SocketId[]>;
  remotePointerViewportCoords: Map<SocketId, { x: number; y: number }>;
  remotePointerUserStates: Map<SocketId, UserIdleState>;
  remotePointerUsernames: Map<SocketId, string>;
  remotePointerButton: Map<SocketId, string | undefined>;
  selectionColor: string;
  lastViewportPosition: { x: number; y: number };
  connectorHandles: ConnectorHandlesRenderConfig | null;
  // extra options passed to the renderer
  // ---------------------------------------------------------------------------
  renderScrollbars?: boolean;
};

/** The connector handles around a hovered shape, and what using one adds. */
export type ConnectorHandlesRenderConfig = {
  elementId: SetsquareElement["id"];
  /** the handle under the pointer, or being dragged */
  active: LinkDirection | null;
  /** where a connector from the active handle lands: a copy of the shape
   * centered on a point, or another shape */
  preview:
    | { type: "node"; center: GlobalPoint }
    | { type: "target"; elementId: SetsquareElement["id"] }
    | null;
};

export type RenderInteractiveSceneCallback = {
  scrollBars?: ScrollBars;
};

export type StaticSceneRenderConfig = {
  canvas: HTMLCanvasElement;
  rc: RoughCanvas;
  elementsMap: RenderableElementsMap;
  allElementsMap: NonDeletedSceneElementsMap;
  visibleElements: readonly NonDeletedSetsquareElement[];
  scale: number;
  appState: StaticCanvasAppState;
  renderConfig: StaticCanvasRenderConfig;
};

export type InteractiveSceneRenderAnimationState = {
  bindingHighlight: { runtime: number } | undefined;
};

export type InteractiveSceneRenderConfig = {
  app: AppClassProperties;
  canvas: HTMLCanvasElement | null;
  elementsMap: RenderableElementsMap;
  visibleElements: readonly NonDeletedSetsquareElement[];
  selectedElements: readonly NonDeletedSetsquareElement[];
  allElementsMap: NonDeletedSceneElementsMap;
  scale: number;
  appState: InteractiveCanvasAppState;
  renderConfig: InteractiveCanvasRenderConfig;
  editorInterface: EditorInterface;
  callback: (data: RenderInteractiveSceneCallback) => void;
  animationState?: InteractiveSceneRenderAnimationState;
  deltaTime: number;
};

export type NewElementSceneRenderConfig = {
  canvas: HTMLCanvasElement | null;
  rc: RoughCanvas;
  newElement: NonDeletedSetsquareElement | null;
  elementsMap: RenderableElementsMap;
  allElementsMap: NonDeletedSceneElementsMap;
  scale: number;
  appState: AppState;
  renderConfig: StaticCanvasRenderConfig;
};

export type SceneScroll = {
  scrollX: number;
  scrollY: number;
};

export type ExportType =
  "png" | "clipboard" | "clipboard-svg" | "backend" | "svg";

export type ScrollBars = {
  horizontal: {
    x: number;
    y: number;
    width: number;
    height: number;
    deltaMultiplier: number;
  } | null;
  vertical: {
    x: number;
    y: number;
    width: number;
    height: number;
    deltaMultiplier: number;
  } | null;
};

export type SVGPathString = string & { __brand: "SVGPathString" };

export type ElementShape =
  Drawable | Drawable[] | Path2D | (Drawable | SVGPathString)[] | null;

export type ElementShapes = {
  rectangle: Drawable;
  ellipse: Drawable;
  diamond: Drawable;
  iframe: Drawable;
  embeddable: Drawable;
  freedraw: (Drawable | SVGPathString)[];
  arrow: Drawable[];
  line: Drawable[];
  text: null;
  stickynote: null;
  image: null;
  frame: null;
  magicframe: null;
};
