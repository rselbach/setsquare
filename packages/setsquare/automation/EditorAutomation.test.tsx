import { z } from "zod";

import { getBoundTextElement, isArrowElement } from "@setsquare/element";

import { Setsquare } from "../index";
import { loadFromBlob } from "../data/blob";
import { API } from "../tests/helpers/api";
import { act, render } from "../tests/test-utils";

import { EditorAutomation } from "./EditorAutomation";

import type { AutomationHost, AutomationResult } from "./EditorAutomation";

const { h } = window;
const identitySchema = z.object({
  documentId: z.string(),
  revision: z.number(),
});
let automation: EditorAutomation;
let host: AutomationHost;
let sequence = 0;
let saved = "";

const call = async (name: string, args: unknown = {}) => {
  let result: AutomationResult | undefined;
  await act(async () => {
    result = await automation.execute(name, args);
  });
  if (!result) {
    throw new Error("Missing result");
  }
  return result;
};

const mutation = async () => {
  const result = await call("get_document");
  const { documentId, revision } = identitySchema.parse(result.data);
  return {
    documentId,
    baseRevision: revision,
    requestId: `request-${++sequence}`,
  };
};

const createDiagram = async () =>
  call("apply_operations", {
    ...(await mutation()),
    operations: [
      {
        kind: "create",
        id: "troy",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 160,
        height: 80,
        label: "Troy Barnes",
      },
      {
        kind: "create",
        id: "abed",
        type: "ellipse",
        x: 350,
        y: 0,
        width: 160,
        height: 80,
        label: "Abed Nadir",
      },
      {
        kind: "connect",
        id: "dreamatorium",
        fromId: "troy",
        toId: "abed",
        label: "Dreamatorium",
      },
    ],
  });

beforeEach(async () => {
  await render(<Setsquare />);
  saved = "";
  host = {
    persist: vi.fn().mockResolvedValue(undefined),
    open: vi.fn(async () => loadFromBlob(new Blob([saved]), null, null)),
    save: vi.fn(async (_path, contents) => {
      saved = contents;
      return {
        name: "greendale.setsquare",
        kind: "file",
      } as FileSystemFileHandle;
    }),
  };
  automation = new EditorAutomation(h.app.api, h.app.ownerDocument, host);
});

it("creates connected labels, moves them together, and undoes one batch", async () => {
  await createDiagram();
  const before = h.app.api.getSceneElements();
  const troy = before.find((element) => element.id === "troy")!;
  const label = getBoundTextElement(troy, h.scene.getNonDeletedElementsMap())!;
  const arrow = before.find((element) => element.id === "dreamatorium")!;
  expect(isArrowElement(arrow) && arrow.startBinding?.elementId).toBe("troy");
  expect(isArrowElement(arrow) && arrow.endBinding?.elementId).toBe("abed");
  expect(troy.boundElements).toContainEqual({ type: "arrow", id: arrow.id });
  const labelPosition = [label.x, label.y];
  const originalArrow = JSON.stringify(arrow);

  await call("apply_operations", {
    ...(await mutation()),
    operations: [{ kind: "move", id: "troy", x: 50, y: 150 }],
  });
  const nextLabel = h.scene.getNonDeletedElementsMap().get(label.id)!;
  expect(nextLabel.x).toBe(labelPosition[0] + 50);
  expect(nextLabel.y).toBe(labelPosition[1] + 150);
  expect(
    JSON.stringify(h.scene.getNonDeletedElementsMap().get(arrow.id)),
  ).not.toBe(originalArrow);
  API.executeAction(h.app.actionManager.actions.undo);
  expect(h.scene.getNonDeletedElementsMap().get("troy")).toMatchObject({
    x: 0,
    y: 0,
  });
  API.executeAction(h.app.actionManager.actions.undo);
  expect(h.app.api.getSceneElements()).toHaveLength(0);
});

it("rejects a failed batch without altering existing elements or history", async () => {
  await createDiagram();
  const before = JSON.stringify(h.elements);
  await expect(
    call("apply_operations", {
      ...(await mutation()),
      operations: [
        { kind: "move", id: "troy", x: 700, y: 0 },
        { kind: "delete", id: "missing" },
      ],
    }),
  ).rejects.toThrow("Element not found");
  expect(JSON.stringify(h.elements)).toBe(before);
  API.executeAction(h.app.actionManager.actions.undo);
  expect(h.app.api.getSceneElements()).toHaveLength(0);
});

it("preserves IDs while editing labels and removes reciprocal bindings on deletion", async () => {
  await createDiagram();
  const troy = h.scene.getNonDeletedElementsMap().get("troy")!;
  const label = getBoundTextElement(troy, h.scene.getNonDeletedElementsMap())!;
  await call("apply_operations", {
    ...(await mutation()),
    operations: [
      { kind: "set_label", id: "troy", text: "Greendale Community College" },
      { kind: "resize", id: "troy", width: 240, height: 120 },
    ],
  });
  expect(h.scene.getNonDeletedElementsMap().get(label.id)).toMatchObject({
    originalText: "Greendale Community College",
  });
  await call("apply_operations", {
    ...(await mutation()),
    operations: [{ kind: "delete", id: "troy" }],
  });
  expect(h.scene.getNonDeletedElementsMap().has(label.id)).toBe(false);
  expect(h.scene.getNonDeletedElementsMap().get("dreamatorium")).toMatchObject({
    startBinding: null,
  });
  expect(
    h.scene.getNonDeletedElementsMap().get("abed")?.boundElements,
  ).toContainEqual({ id: "dreamatorium", type: "arrow" });
});

it("detects user edits, but ignores selection and viewport changes", async () => {
  await createDiagram();
  const request = await mutation();
  await call("set_view", {
    documentId: request.documentId,
    elementIds: ["troy"],
  });
  expect((await mutation()).baseRevision).toBe(request.baseRevision);
  act(() =>
    h.app.api.mutateElement(h.scene.getNonDeletedElementsMap().get("troy")!, {
      x: 75,
    }),
  );
  await expect(
    call("apply_operations", {
      ...request,
      operations: [{ kind: "delete", id: "troy" }],
    }),
  ).rejects.toThrow("Revision conflict");
});

it("deduplicates retries and rejects reusing a request ID for another edit", async () => {
  const request = {
    ...(await mutation()),
    operations: [{ kind: "create", type: "rectangle", x: 0, y: 0 }],
  };
  const first = await call("apply_operations", request);
  expect(await call("apply_operations", request)).toEqual(first);
  expect(h.app.api.getSceneElements()).toHaveLength(1);
  await expect(
    call("apply_operations", {
      ...request,
      operations: [{ kind: "create", type: "ellipse", x: 0, y: 0 }],
    }),
  ).rejects.toThrow("different arguments");
});

it("validates input and protects locked elements", async () => {
  await createDiagram();
  await expect(
    call("apply_operations", {
      ...(await mutation()),
      operations: [{ kind: "move", id: "troy", x: Infinity, y: 0 }],
    }),
  ).rejects.toThrow();
  act(() =>
    h.app.api.mutateElement(h.scene.getNonDeletedElementsMap().get("troy")!, {
      locked: true,
    }),
  );
  await expect(
    call("apply_operations", {
      ...(await mutation()),
      operations: [{ kind: "delete", id: "troy" }],
    }),
  ).rejects.toThrow("locked");
});

it("reports a persistence failure without applying the edit again on retry", async () => {
  vi.mocked(host.persist).mockRejectedValue(new Error("storage is full"));
  const request = {
    ...(await mutation()),
    operations: [{ kind: "text", text: "Greendale", x: 10, y: 10 }],
  };
  const first = await call("apply_operations", request);
  expect(first.data).toMatchObject({
    persisted: false,
    persistenceError: "storage is full",
  });
  expect(await call("apply_operations", request)).toEqual(first);
  expect(h.app.api.getSceneElements()).toHaveLength(1);
});

it("saves and reopens the diagram, while requiring explicit replacement", async () => {
  await createDiagram();
  await call("save_document", {
    ...(await mutation()),
    path: "/tmp/greendale.setsquare",
  });
  expect(JSON.parse(saved).elements).toHaveLength(6);
  await expect(
    call("new_document", { ...(await mutation()), name: "Study room" }),
  ).rejects.toThrow("not empty");
  await call("new_document", {
    ...(await mutation()),
    name: "Study room",
    replace: true,
  });
  expect(h.app.api.getSceneElements()).toHaveLength(0);
  await call("open_document", {
    ...(await mutation()),
    path: "/tmp/greendale.setsquare",
  });
  expect(h.app.api.getSceneElements()).toHaveLength(6);
  expect(h.scene.getNonDeletedElementsMap().get("dreamatorium")).toMatchObject({
    startBinding: { elementId: "troy" },
  });
});

it("rechecks the revision after an asynchronous open", async () => {
  await createDiagram();
  let finish!: (scene: Awaited<ReturnType<AutomationHost["open"]>>) => void;
  vi.mocked(host.open).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const request = await mutation();
  const opening = automation.execute("open_document", {
    ...request,
    path: "/tmp/greendale.setsquare",
    replace: true,
  });
  const rejected = expect(opening).rejects.toThrow("Revision conflict");
  await Promise.resolve();
  act(() =>
    h.app.api.mutateElement(h.scene.getNonDeletedElementsMap().get("troy")!, {
      x: 75,
    }),
  );
  finish({ elements: [], appState: h.state, files: {} });
  await rejected;
  expect(h.app.api.getSceneElements()).toHaveLength(6);
  expect(h.scene.getNonDeletedElementsMap().get("troy")).toMatchObject({
    x: 75,
  });
});

it("returns the committed revision even when a user edits during persistence", async () => {
  await createDiagram();
  const request = await mutation();
  let finish!: () => void;
  vi.mocked(host.persist).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let result: AutomationResult | undefined;
  await act(async () => {
    const editing = automation.execute("apply_operations", {
      ...request,
      operations: [{ kind: "move", id: "troy", x: 50, y: 50 }],
    });
    await Promise.resolve();
    await Promise.resolve();
    h.app.api.mutateElement(h.scene.getNonDeletedElementsMap().get("abed")!, {
      x: 600,
    });
    finish();
    result = await editing;
  });
  const committed = identitySchema.parse(result?.data);
  const current = await mutation();
  expect(committed.revision).toBeLessThan(current.baseRevision);
});

it("uses the requested sticky-note height after label fitting", async () => {
  await call("apply_operations", {
    ...(await mutation()),
    operations: [
      {
        kind: "create",
        id: "study-room",
        type: "stickynote",
        x: 0,
        y: 0,
        label: "Study group",
      },
      { kind: "resize", id: "study-room", width: 240, height: 300 },
    ],
  });
  expect(h.scene.getNonDeletedElementsMap().get("study-room")).toMatchObject({
    width: 240,
    height: 300,
    baseHeight: 300,
  });
  await call("apply_operations", {
    ...(await mutation()),
    operations: [
      {
        kind: "style",
        id: "study-room",
        style: { strokeColor: "#ff0000", backgroundColor: "transparent" },
      },
    ],
  });
  const note = h.scene.getNonDeletedElementsMap().get("study-room")!;
  const label = getBoundTextElement(note, h.scene.getNonDeletedElementsMap())!;
  expect(note.strokeColor).toBe("#ff0000");
  expect(label.strokeColor).toBe(note.strokeColor);
  expect(note.backgroundColor).not.toBe("transparent");
});
