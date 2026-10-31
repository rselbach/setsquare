import { getDefaultAppState } from "@setsquare/setsquare/appState";
import { API } from "@setsquare/setsquare/tests/helpers/api";

import type { FileId } from "@setsquare/element/types";

import {
  contentWrite,
  persistedSignature,
  recoveredRequest,
  sceneContent,
  sceneDraft,
} from "../../../web/persistence/saveContent";

import type {
  PendingScene,
  PinnedRequest,
} from "../../../web/persistence/saveContent";
import type { DrawingId } from "../../../workspace/types";

const DRAWING = "greendale" as DrawingId;

const image = (id: string, fileId: string, isDeleted = false) =>
  API.createElement({
    type: "image",
    id,
    fileId: fileId as FileId,
    status: "saved",
    isDeleted,
  });

const scene = (
  elements: PendingScene["elements"],
  name = "Greendale",
): PendingScene => ({
  elements,
  appState: {
    ...getDefaultAppState(),
    width: 800,
    height: 600,
    name,
    offsetTop: 0,
    offsetLeft: 0,
    scrollX: 42,
  },
  files: {},
  onFilesSaved: () => {},
});

describe("contentWrite", () => {
  it("writes the shown elements and each image they show once", () => {
    const write = contentWrite(
      sceneContent(
        scene([
          image("troy", "dreamatorium"),
          image("abed", "dreamatorium"),
          image("pierce", "hawthorne-wipes", true),
        ]),
      ),
    );
    expect(write.content.elements.map((element) => element.id)).toEqual([
      "troy",
      "abed",
    ]);
    expect(write.fileIds).toEqual(["dreamatorium"]);
    expect(write.content.appState).not.toHaveProperty("scrollX");
  });

  it("signs a scene as the editor's edits are signed", () => {
    const pending = scene([
      image("troy", "dreamatorium"),
      image("pierce", "hawthorne-wipes", true),
    ]);
    expect(contentWrite(sceneContent(pending)).signature).toBe(
      persistedSignature(pending.elements, pending.appState).content,
    );
    expect(contentWrite(sceneContent(scene([], "Annie"))).signature).not.toBe(
      contentWrite(sceneContent(scene([]))).signature,
    );
  });
});

describe("recoveredRequest", () => {
  it("resends the request's content, not the draft's newer scene", () => {
    const sent = contentWrite(sceneContent(scene([image("troy", "a")])));
    const request = recoveredRequest(
      { requestId: "dean-pelton", baseRevision: 4, content: sent.content },
      scene([image("troy", "a"), image("abed", "b")], "Annie"),
    );
    expect(request).toMatchObject({
      phase: "content",
      uncertain: true,
      requestId: "dean-pelton",
      baseRevision: 4,
      signature: sent.signature,
      fileIds: ["a"],
    });
    expect(request.scene.elements).toBe(sent.content.elements);
    expect(request.scene.appState.name).toBe("Greendale");
    expect(request.scene.appState.scrollX).toBe(42);
  });
});

describe("sceneDraft", () => {
  const pending = scene([image("troy", "a"), image("pierce", "b", true)]);
  const write = contentWrite(sceneContent(pending));
  const request = (phase: PinnedRequest["phase"]): PinnedRequest => ({
    ...write,
    phase,
    uncertain: false,
    scene: pending,
    requestId: "dean-pelton",
    baseRevision: 2,
  });

  it("keeps the shown elements, the view, and a content request", () => {
    const draft = sceneDraft(DRAWING, 3, pending, request("content"));
    expect(draft.elements.map((element) => element.id)).toEqual(["troy"]);
    expect(draft.appState.scrollX).toBe(42);
    expect(draft.baseRevision).toBe(3);
    expect(draft.request).toEqual({
      requestId: "dean-pelton",
      baseRevision: 2,
      content: write.content,
    });
  });

  it.each(
    Object.entries({
      "no request": null,
      "a request whose content committed": request("view"),
    }),
  )("leaves the request out with %s", (_, tc) => {
    expect(sceneDraft(DRAWING, 3, pending, tc).request).toBeUndefined();
  });
});
