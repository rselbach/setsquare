import {
  getNonDeletedElements,
  hashElementsVersion,
  isInitializedImageElement,
} from "@setsquare/element";
import { getDefaultAppState } from "@setsquare/setsquare/appState";

import type { FileId, SetsquareElement } from "@setsquare/element/types";
import type { AppState } from "@setsquare/setsquare/types";

import {
  DRAWING_CONTENT_KEYS,
  DRAWING_VIEW_KEYS,
  splitAppState,
} from "../../workspace/drawingAppState";
import { loadPrefs } from "../../workspace/prefs";

import type {
  DrawingContent,
  DrawingContentAppState,
  DrawingDraft,
  DrawingId,
  DrawingView,
} from "../../workspace/types";
import type { ThumbnailScene } from "../thumbnail";

/** The images the elements show, each once. */
export const imageFileIds = (
  elements: readonly SetsquareElement[],
): FileId[] => [
  ...new Set(
    elements.filter(isInitializedImageElement).map((element) => element.fileId),
  ),
];

/** Identifies drawing content, so equal content is never written twice. */
export const contentSignature = (
  elements: readonly SetsquareElement[],
  appState: DrawingContentAppState,
) =>
  `${JSON.stringify(
    elements.map((element) => element.id),
  )}:${hashElementsVersion(elements)}:${JSON.stringify(
    DRAWING_CONTENT_KEYS.map((key) => appState[key]),
  )}`;

/** Identifies where a drawing was left, so an equal view is never rewritten. */
export const viewSignature = (view: DrawingView) =>
  JSON.stringify(DRAWING_VIEW_KEYS.map((key) => view[key]));

/** What the drawing's storage keeps of a scene, as content and view. */
export const persistedSignature = (
  elements: readonly SetsquareElement[],
  appState: AppState,
) => {
  const { content, view } = splitAppState(appState);
  return {
    content: contentSignature(getNonDeletedElements(elements), content),
    view: viewSignature(view),
  };
};

/** A scene waiting to save, and what to tell the editor once its images have. */
export type PendingScene = ThumbnailScene & { onFilesSaved: () => void };

/** What saving content sends, and the signature the drawing then has. */
export type ContentWrite = {
  content: DrawingContent;
  fileIds: FileId[];
  signature: string;
};

/** The content the drawing's storage keeps of a scene. */
export const sceneContent = (scene: ThumbnailScene): DrawingContent => ({
  elements: getNonDeletedElements(scene.elements),
  appState: splitAppState(scene.appState).content,
});

/** Builds every content write, to the drawing and to a copy of it alike. */
export const contentWrite = (content: DrawingContent): ContentWrite => ({
  content,
  fileIds: imageFileIds(content.elements),
  signature: contentSignature(content.elements, content.appState),
});

/** The scene a recovered draft left, sized by the editor once it opens. */
export const draftScene = (draft: DrawingDraft): PendingScene => ({
  elements: draft.elements,
  appState: {
    ...getDefaultAppState(),
    width: 0,
    height: 0,
    offsetTop: 0,
    offsetLeft: 0,
    ...loadPrefs(),
    ...draft.appState,
  },
  files: {},
  onFilesSaved: () => {},
});

/**
 * A content write pinned until its outcome is known, so a write that may
 * have committed is resent exactly as it was and the store's receipt
 * dedupes it. It is pinned from the moment it is built until it commits,
 * conflicts, or fails for certain; only in its `content` phase does it go
 * into the recovery draft.
 */
export type PinnedRequest = ContentWrite & {
  phase: "content" | "view";
  uncertain: boolean;
  scene: PendingScene;
  requestId: string;
  baseRevision: number;
};

/** The request a recovered draft left, whose outcome is unknown. */
export const recoveredRequest = (
  { requestId, baseRevision, content }: NonNullable<DrawingDraft["request"]>,
  scene: PendingScene,
): PinnedRequest => ({
  ...contentWrite(content),
  phase: "content",
  uncertain: true,
  scene: {
    ...scene,
    elements: content.elements,
    appState: { ...scene.appState, ...content.appState },
  },
  requestId,
  baseRevision,
});

/** The recovery draft of a pending scene and the request pinned for it. */
export const sceneDraft = (
  id: DrawingId,
  baseRevision: number,
  scene: ThumbnailScene,
  request: PinnedRequest | null,
): DrawingDraft => {
  const { content, view } = splitAppState(scene.appState);
  return {
    id,
    baseRevision,
    elements: getNonDeletedElements(scene.elements),
    appState: { ...content, ...view },
    request:
      request?.phase === "content"
        ? {
            requestId: request.requestId,
            baseRevision: request.baseRevision,
            content: request.content,
          }
        : undefined,
  };
};
