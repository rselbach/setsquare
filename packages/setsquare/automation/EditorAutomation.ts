import { flushSync } from "react-dom";

import { cloneJSON, randomId } from "@setsquare/common";
import {
  CaptureUpdateAction,
  convertToSetsquareElements,
  getBoundTextElement,
  getCommonBounds,
  isArrowElement,
  isTextElement,
} from "@setsquare/element";
import { exportToBlob } from "@setsquare/utils/export";

import type { SetsquareElement } from "@setsquare/element/types";

import { getDefaultAppState } from "../appState";
import { getDataURL } from "../data/blob";
import { serializeAsJSON } from "../data/json";
import { Fonts } from "../fonts/Fonts";

import { applyOperations } from "./operations";
import { toolSchemas } from "./schema";

import type { Mutation } from "./schema";
import type { AppState, BinaryFiles, SetsquareImperativeAPI } from "../types";
import type { RestoredDataState } from "../data/restore";

export type AutomationResult =
  | { kind: "json"; data: unknown }
  | { kind: "image"; data: string; documentId: string; revision: number };

type DocumentVersion = { documentId: string; revision: number };

/** Persistence belongs to the host app, not the reusable editor. */
export interface AutomationHost {
  persist(): Promise<void>;
  open(path: string, callId: string): Promise<RestoredDataState>;
  save(
    path: string,
    contents: string,
    overwrite: boolean,
    callId: string,
  ): Promise<FileSystemFileHandle>;
}

/** Executes validated commands against one mounted editor. */
export class EditorAutomation {
  private documentId = randomId();
  private revision = 0;
  private fingerprint = "";
  private fileHandle: AppState["fileHandle"];
  private queue: Promise<void> = Promise.resolve();
  private completed = new Map<
    string,
    { input: string; result: AutomationResult }
  >();

  constructor(
    private api: SetsquareImperativeAPI,
    private ownerDocument: Document,
    private host: AutomationHost,
  ) {
    this.fileHandle = api.getAppState().fileHandle;
    this.refreshRevision();
  }

  private refreshRevision() {
    const state = this.api.getAppState();
    if (state.fileHandle !== this.fileHandle) {
      this.fileHandle = state.fileHandle;
      this.documentId = randomId();
    }
    const fingerprint = JSON.stringify([
      this.api
        .getSceneElementsIncludingDeleted()
        .map((element) => [
          element.id,
          element.version,
          element.versionNonce,
          element.index,
          element.isDeleted,
        ]),
      state.name,
      state.viewBackgroundColor,
    ]);
    if (fingerprint !== this.fingerprint) {
      this.fingerprint = fingerprint;
      this.revision++;
    }
  }

  private identity() {
    this.refreshRevision();
    return { documentId: this.documentId, revision: this.revision };
  }

  private checkDocument(documentId: string) {
    this.refreshRevision();
    if (documentId !== this.documentId) {
      throw new Error("Document changed. Call get_document before continuing.");
    }
  }

  private checkMutation(
    request: Pick<Mutation, "documentId" | "baseRevision">,
  ) {
    this.checkDocument(request.documentId);
    if (request.baseRevision !== this.revision) {
      throw new Error(
        "Revision conflict. Call get_document and reapply your intended edit to the current drawing.",
      );
    }
    const state = this.api.getAppState();
    if (
      state.viewModeEnabled ||
      state.newElement ||
      state.isRotating ||
      state.croppingElementId ||
      state.editingTextElement ||
      state.resizingElement ||
      state.selectedElementsAreBeingDragged
    ) {
      throw new Error(
        "Editor is busy or in view mode. Finish the current interaction before editing.",
      );
    }
  }

  private read() {
    const elements = this.api.getSceneElements();
    const map = this.api.getSceneElementsMapIncludingDeleted();
    return {
      ...this.identity(),
      name: this.api.getName(),
      selectedIds: Object.keys(this.api.getAppState().selectedElementIds),
      elements: elements.map((element) => ({
        id: element.id,
        type: element.type,
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        angle: element.angle,
        label: isTextElement(element)
          ? element.originalText
          : getBoundTextElement(element, map)?.originalText,
        containerId: isTextElement(element) ? element.containerId : undefined,
        fromId: isArrowElement(element)
          ? element.startBinding?.elementId
          : undefined,
        toId: isArrowElement(element)
          ? element.endBinding?.elementId
          : undefined,
        groupIds: element.groupIds,
        frameId: element.frameId,
        locked: element.locked,
        strokeColor: element.strokeColor,
        backgroundColor: element.backgroundColor,
      })),
    };
  }

  private commit(
    elements: readonly SetsquareElement[],
    appState?: Partial<AppState>,
    files?: BinaryFiles,
  ) {
    flushSync(() => {
      if (files) {
        this.api.addFiles(Object.values(files));
      }
      this.api.updateScene({
        elements,
        appState: appState
          ? { ...this.api.getAppState(), ...appState }
          : undefined,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    });
  }

  private async mutate(
    name: string,
    request: Pick<Mutation, "documentId" | "baseRevision" | "requestId">,
    assertActive: () => void,
    run: () => Promise<DocumentVersion> | DocumentVersion,
  ): Promise<AutomationResult> {
    const key = `${request.documentId}:${request.requestId}`;
    const input = JSON.stringify([name, request]);
    const previous = this.completed.get(key);
    if (previous) {
      if (previous.input !== input) {
        throw new Error("requestId was already used with different arguments");
      }
      return previous.result;
    }
    assertActive();
    this.checkMutation(request);
    const details = await run();
    let persistenceError: string | undefined;
    try {
      await this.host.persist();
    } catch (error) {
      persistenceError = error instanceof Error ? error.message : String(error);
    }
    const result: AutomationResult = {
      kind: "json",
      data: {
        ...details,
        persisted: !persistenceError,
        persistenceError,
      },
    };
    this.completed.set(key, { input, result });
    if (this.completed.size > 100) {
      const oldest = this.completed.keys().next().value;
      if (oldest) {
        this.completed.delete(oldest);
      }
    }
    return result;
  }

  execute(
    name: string,
    args: unknown,
    assertActive: () => void = () => {},
    callId = "",
  ): Promise<AutomationResult> {
    const task = this.queue.then(() => {
      assertActive();
      if (this.api.isDestroyed || this.api.getAppState().isLoading) {
        throw new Error("Editor is not ready");
      }
      return this.dispatch(name, args, assertActive, callId);
    });
    this.queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private async dispatch(
    name: string,
    args: unknown,
    assertActive: () => void,
    callId: string,
  ): Promise<AutomationResult> {
    switch (name) {
      case "get_document":
        toolSchemas.get_document.parse(args);
        return { kind: "json", data: this.read() };
      case "apply_operations": {
        const request = toolSchemas.apply_operations.parse(args);
        return this.mutate(name, request, assertActive, () => {
          const result = applyOperations(
            this.api.getSceneElementsIncludingDeleted(),
            request.operations,
          );
          assertActive();
          this.checkMutation(request);
          this.commit(result.elements);
          return { ...this.identity(), createdIds: result.createdIds };
        });
      }
      case "import_mermaid": {
        const request = toolSchemas.import_mermaid.parse(args);
        return this.mutate(name, request, assertActive, async () => {
          const { parseMermaidToSetsquare } =
            await import("@setsquare/mermaid-to-setsquare");
          const converted = await parseMermaidToSetsquare(request.source);
          const elements = convertToSetsquareElements(converted.elements);
          const [left, top] = getCommonBounds(elements);
          const translated = elements.map((element) => ({
            ...element,
            x: element.x + request.x - left,
            y: element.y + request.y - top,
          }));
          await Fonts.loadElementsFonts(translated, this.ownerDocument);
          assertActive();
          this.checkMutation(request);
          this.commit(
            [...this.api.getSceneElementsIncludingDeleted(), ...translated],
            undefined,
            converted.files,
          );
          return {
            ...this.identity(),
            createdIds: translated.map((element) => element.id),
          };
        });
      }
      case "render_document": {
        const request = toolSchemas.render_document.parse(args);
        this.checkDocument(request.documentId);
        const identity = this.identity();
        const elements = cloneJSON(this.api.getSceneElements());
        const appState = { ...this.api.getAppState(), exportEmbedScene: false };
        const files = { ...this.api.getFiles() };
        await Fonts.loadElementsFonts(elements, this.ownerDocument);
        assertActive();
        const blob = await exportToBlob({
          elements,
          appState,
          files,
          maxWidthOrHeight: request.maxSize,
        });
        const data = await getDataURL(blob);
        return {
          kind: "image",
          data: data.slice(data.indexOf(",") + 1),
          ...identity,
        };
      }
      case "set_view": {
        const request = toolSchemas.set_view.parse(args);
        this.checkDocument(request.documentId);
        const elements = this.api.getSceneElements();
        const targets = request.elementIds.length
          ? request.elementIds.map((id) => {
              const element = elements.find((element) => element.id === id);
              if (!element) {
                throw new Error(`Element not found: ${id}`);
              }
              return element;
            })
          : elements;
        flushSync(() => {
          if (request.select) {
            this.api.selection.select(request.elementIds, {
              captureUpdate: CaptureUpdateAction.NEVER,
            });
          }
          this.api.setViewport({
            target: targets,
            fit: "scale-down",
            animation: false,
          });
        });
        return {
          kind: "json",
          data: {
            ...this.identity(),
            selectedIds: Object.keys(this.api.getAppState().selectedElementIds),
          },
        };
      }
      case "new_document": {
        const request = toolSchemas.new_document.parse(args);
        return this.mutate(name, request, assertActive, () => {
          this.checkReplace(request.replace);
          this.replace([], { ...getDefaultAppState(), name: request.name }, {});
          return this.identity();
        });
      }
      case "open_document": {
        const request = toolSchemas.open_document.parse(args);
        return this.mutate(name, request, assertActive, async () => {
          this.checkReplace(request.replace);
          const scene = await this.host.open(request.path, callId);
          assertActive();
          this.checkMutation(request);
          this.replace(scene.elements, scene.appState, scene.files);
          return { ...this.identity(), path: request.path };
        });
      }
      case "save_document": {
        const request = toolSchemas.save_document.parse(args);
        return this.mutate(name, request, assertActive, async () => {
          const contents = serializeAsJSON(
            this.api.getSceneElements(),
            this.api.getAppState(),
            this.api.getFiles(),
            "local",
          );
          const savedVersion = this.identity();
          const handle = await this.host.save(
            request.path,
            contents,
            request.overwrite,
            callId,
          );
          if (this.identity().documentId === request.documentId) {
            flushSync(() =>
              this.api.updateScene({
                appState: { fileHandle: handle },
                captureUpdate: CaptureUpdateAction.NEVER,
              }),
            );
            this.fileHandle = handle;
          }
          return {
            ...savedVersion,
            path: request.path,
            savedRevision: savedVersion.revision,
          };
        });
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private checkReplace(replace: boolean) {
    if (!replace && this.api.getSceneElements().length) {
      throw new Error(
        "The current drawing is not empty. Save it first, then pass replace:true.",
      );
    }
  }

  private replace(
    elements: readonly SetsquareElement[],
    appState: Partial<AppState>,
    files: BinaryFiles,
  ) {
    flushSync(() => {
      this.api.resetScene({ resetLoadingState: true });
      this.api.addFiles(Object.values(files));
      this.api.updateScene({
        elements,
        appState: { ...this.api.getAppState(), ...appState, isLoading: false },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    });
    this.documentId = randomId();
    this.fileHandle = this.api.getAppState().fileHandle;
  }
}
