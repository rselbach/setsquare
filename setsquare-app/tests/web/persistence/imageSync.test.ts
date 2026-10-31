import { getDefaultAppState } from "@setsquare/setsquare/appState";
import { API } from "@setsquare/setsquare/tests/helpers/api";

import type { FileId } from "@setsquare/element/types";
import type {
  BinaryFileData,
  BinaryFiles,
  DataURL,
} from "@setsquare/setsquare/types";

import { FileSaveError } from "../../../data/FileManager";
import { createImageSync } from "../../../web/persistence/imageSync";

import type { PendingScene } from "../../../web/persistence/saveContent";
import type { WorkspaceStore } from "../../../workspace/WorkspaceStore";

const file = (id: string): BinaryFileData => ({
  id: id as FileId,
  mimeType: "image/png",
  dataURL: `data:image/png;base64,${id}` as DataURL,
  created: 1,
});

const sceneShowing = (...ids: string[]): PendingScene => ({
  elements: ids.map((id) =>
    API.createElement({ type: "image", fileId: id as FileId, status: "saved" }),
  ),
  appState: getDefaultAppState() as PendingScene["appState"],
  files: Object.fromEntries(
    ["dreamatorium", "paintball", "blanket-fort"].map((id) => [id, file(id)]),
  ),
  onFilesSaved: vi.fn(),
});

const syncWith = (store: Partial<WorkspaceStore>) => {
  let generation = "season-1";
  let pending: PendingScene | null = null;
  const onFailure = vi.fn();
  const images = createImageSync({
    store: {
      files: {
        get: vi.fn(),
        save: vi.fn(
          async ({
            addedFiles,
          }: {
            addedFiles: Map<FileId, BinaryFileData>;
          }) => ({
            savedFiles: addedFiles,
            erroredFiles: new Map(),
          }),
        ),
      },
      ...store,
    } as Partial<WorkspaceStore> as WorkspaceStore,
    savedFileIds: [],
    generation: () => generation,
    pending: () => pending,
    onFailure,
  });
  return {
    images,
    onFailure,
    setGeneration: (next: string) => {
      generation = next;
    },
    setPending: (next: PendingScene) => {
      pending = next;
    },
  };
};

describe("createImageSync", () => {
  it("stages the images the scene shows and those a pinned request needs", async () => {
    const stageFiles = vi.fn(async (_: BinaryFiles) => {});
    const { images } = syncWith({ stageFiles });
    images.stage(sceneShowing("dreamatorium"), ["blanket-fort" as FileId]);
    await images.settle();
    expect(Object.keys(stageFiles.mock.calls[0][0]).sort()).toEqual([
      "blanket-fort",
      "dreamatorium",
    ]);
    expect(images.isStored()).toBe(true);
    expect(images.error()).toBeNull();
  });

  it("isn't durable for an edit made after the staging began", async () => {
    const { images, setGeneration } = syncWith({
      stageFiles: async () => {},
    });
    images.stage(sceneShowing("paintball"), []);
    setGeneration("season-2");
    await images.settle();
    expect(images.isStored()).toBe(false);
  });

  const full = new DOMException("full", "QuotaExceededError");
  it.each(
    Object.entries({
      "the edit it staged": { editMeanwhile: false, want: full },
      "a later edit": { editMeanwhile: true, want: null },
    }),
  )("blames a failed staging on %s", async (_, tc) => {
    const { images, onFailure, setGeneration } = syncWith({
      stageFiles: async () => {
        throw full;
      },
    });
    images.stage(sceneShowing("paintball"), []);
    if (tc.editMeanwhile) {
      setGeneration("season-2");
    }
    await images.settle();
    expect(images.error()).toBe(tc.want);
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it("fails an upload that leaves an image unsaved", async () => {
    const refused = new Error("Pierce's file is too large");
    const { images } = syncWith({
      files: {
        get: vi.fn(),
        save: async ({ addedFiles }) => ({
          savedFiles: new Map(),
          erroredFiles: addedFiles,
          errors: new Map([...addedFiles.keys()].map((id) => [id, refused])),
        }),
      },
    });
    const scene = sceneShowing("dreamatorium");
    const failure = await images.upload(scene).catch((error) => error);
    expect(failure).toBeInstanceOf(FileSaveError);
    expect([...failure.errors.values()]).toEqual([refused]);
    expect(scene.onFilesSaved).not.toHaveBeenCalled();
  });

  it("counts uploaded images as durable where the store stages nothing", async () => {
    const { images, setPending } = syncWith({});
    const scene = sceneShowing("dreamatorium");
    setPending(scene);
    images.stage(scene, []);
    await images.settle();
    expect(images.error()).toEqual(
      new Error("The drawing's images have not been stored on this device"),
    );
    await images.upload(scene);
    expect(images.isStored()).toBe(true);
    expect(images.error()).toBeNull();
    expect(scene.onFilesSaved).toHaveBeenCalled();
  });
});
