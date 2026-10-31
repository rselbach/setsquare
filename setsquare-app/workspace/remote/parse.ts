import { getNonDeletedElements } from "@setsquare/element";
import {
  restoreAppState,
  restoreElements,
} from "@setsquare/setsquare/data/restore";
import { getNormalizedZoom } from "@setsquare/setsquare/scene/normalize";
import { z } from "zod";

import type { SetsquareElement } from "@setsquare/element/types";
import type { Radians } from "@setsquare/math";
import type { ImportedDataState } from "@setsquare/setsquare/data/types";

import { splitAppState } from "../drawingAppState";

import type {
  CommandResponse,
  DrawingData,
  FilesData,
  SessionInfo,
  WorkspaceData,
} from "../api";
import type { AccountDraft, DrawingId, FolderId, Thumbnail } from "../types";

const id = z.string().min(1).max(256);
const drawingId = id.transform((value) => value as DrawingId);
const folderId = id.transform((value) => value as FolderId);
const fileId = id.transform(
  (value) => value as FilesData["files"][number]["id"],
);
const timestamp = z.number().finite().nonnegative();
const revision = z.number().int().positive();
const point = z.tuple([z.number().finite(), z.number().finite()]);
const dataURL = z
  .string()
  .regex(/^data:(?:image\/[a-zA-Z0-9.+-]+|application\/octet-stream);base64,/)
  .transform((value) => value as Thumbnail["src"]);

const folderSchema = z.object({
  id: folderId,
  name: z.string(),
  parentId: folderId.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
  trashedAt: timestamp.nullable(),
});

const metaSchema = z.object({
  id: drawingId,
  name: z.string().nullable(),
  folderId: folderId.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
  openedAt: timestamp.nullable(),
  trashedAt: timestamp.nullable(),
  revision,
  fileIds: z.array(fileId),
});

const elementSchema = z
  .object({
    id,
    type: z.enum([
      "rectangle",
      "diamond",
      "ellipse",
      "stickynote",
      "text",
      "line",
      "arrow",
      "freedraw",
      "image",
      "frame",
      "magicframe",
      "iframe",
      "embeddable",
    ]),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite(),
    height: z.number().finite(),
    strokeColor: z.string(),
    backgroundColor: z.string(),
    fillStyle: z.enum(["hachure", "cross-hatch", "solid", "zigzag"]),
    strokeWidth: z.number().finite(),
    strokeStyle: z.enum(["solid", "dashed", "dotted"]),
    roundness: z
      .object({ type: z.number(), value: z.number().optional() })
      .nullable(),
    roughness: z.number().finite(),
    opacity: z.number().finite(),
    angle: z
      .number()
      .finite()
      .transform((value) => value as Radians),
    seed: z.number().finite(),
    version: z.number().finite(),
    versionNonce: z.number().finite(),
    index: z.string().nullable(),
    groupIds: z.array(id),
    frameId: id.nullable(),
    boundElements: z
      .array(z.object({ id, type: z.enum(["arrow", "text"]) }))
      .nullable(),
    updated: timestamp,
    created: timestamp.nullable().default(null),
    link: z.string().nullable(),
    locked: z.boolean(),
    points: z.array(point).optional(),
    pressures: z.array(z.number().finite()).optional(),
    text: z.string().optional(),
    originalText: z.string().optional(),
    fileId: fileId.nullable().optional(),
    scale: point.optional(),
    isDeleted: z.boolean().optional(),
  })
  .catchall(z.json())
  .superRefine((element, context) => {
    if (element.type === "text" && typeof element.text !== "string") {
      context.addIssue({ code: "custom", message: "Missing text" });
    }
    if (
      ["line", "arrow", "freedraw"].includes(element.type) &&
      !Array.isArray(element.points)
    ) {
      context.addIssue({ code: "custom", message: "Missing points" });
    }
  });

const contentSchema = z
  .object({
    elements: z.array(elementSchema).max(100_000),
    appState: z.object({
      name: z.string().nullable(),
      viewBackgroundColor: z.string(),
      gridSize: z.number().finite(),
      gridStep: z.number().finite(),
      gridModeEnabled: z.boolean(),
      lockedMultiSelections: z.record(z.string(), z.literal(true)),
    }),
  })
  .transform(({ elements, appState }): DrawingData["content"] => {
    // the editor's import boundary fills defaults and migrates saved scenes
    const restored = restoreElements(elements as SetsquareElement[], null);
    const state = restoreAppState(
      appState as ImportedDataState["appState"],
      null,
    );
    return {
      elements: getNonDeletedElements(restored),
      appState: splitAppState(state).content,
    };
  });

const workspaceSchema = z.object({
  folders: z.array(folderSchema),
  drawings: z.array(metaSchema),
});
const drawingSchema = z.object({ meta: metaSchema, content: contentSchema });
const changeSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.literal("notFound") }),
]);
const saveSchema = z.union([
  z.object({ ok: z.literal(true), meta: metaSchema }),
  z.object({ ok: z.literal(false), reason: z.literal("notFound") }),
  z.object({
    ok: z.literal(false),
    reason: z.literal("conflict"),
    meta: metaSchema,
  }),
]);
const responseSchema = z.object({
  snapshot: workspaceSchema,
  result: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("folder"), folder: folderSchema }),
    z.object({ kind: z.literal("drawing"), drawing: metaSchema.nullable() }),
    z.object({ kind: z.literal("save"), result: saveSchema }),
    z.object({ kind: z.literal("change"), result: changeSchema }),
    z.object({
      kind: z.literal("move"),
      result: z.union([
        z.object({ ok: z.literal(true) }),
        z.object({
          ok: z.literal(false),
          reason: z.enum([
            "notFound",
            "intoItself",
            "intoDescendant",
            "targetTrashed",
          ]),
        }),
      ]),
    }),
    z.object({ kind: z.literal("done") }),
  ]),
});

const fileSchema = z.object({
  id: fileId,
  dataURL,
  mimeType: z.enum([
    "image/svg+xml",
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/bmp",
    "image/x-icon",
    "image/avif",
    "image/jfif",
    "application/octet-stream",
  ]),
  created: timestamp,
  lastRetrieved: timestamp.optional(),
  version: revision.optional(),
});
const thumbnailSchema = z.object({ src: dataURL, revision });

/** Parses the current account state returned by the server. */
export const parseSession = (value: unknown): SessionInfo =>
  z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("local") }),
      z.object({ kind: z.literal("signedOut") }),
      z.object({
        kind: z.literal("signedIn"),
        user: z.object({
          id,
          login: z.string().min(1),
          name: z.string().nullable(),
          avatarUrl: z.string(),
        }),
        csrfToken: z.string().min(1),
      }),
    ])
    .parse(value);

/** Parses a metadata-only snapshot. */
export const parseWorkspace = (value: unknown): WorkspaceData =>
  workspaceSchema.parse(value);

/** Restores a saved drawing at the network boundary. */
export const parseDrawing = (value: unknown): DrawingData =>
  drawingSchema.parse(value);

/** Parses a committed mutation and its metadata snapshot. */
export const parseCommand = (value: unknown): CommandResponse =>
  responseSchema.parse(value);

/** Parses images from the server or the local account cache. */
export const parseFiles = (value: unknown): FilesData =>
  z.object({ files: z.array(fileSchema) }).parse(value);

/** Parses one response of images and the requested ids it left for later. */
export const parseFilePage = (value: unknown) =>
  z
    .object({
      files: z.array(fileSchema),
      remaining: z.array(fileId).default([]),
    })
    .parse(value);

/** Parses cached thumbnail entries. */
export const parseThumbnails = (value: unknown) =>
  z
    .object({ thumbnails: z.array(z.tuple([drawingId, thumbnailSchema])) })
    .parse(value).thumbnails;

/** Parses a device-local drawing view through the editor's importer. */
export const parseView = (value: unknown) => {
  const view = z
    .object({
      scrollX: z.number().finite(),
      scrollY: z.number().finite(),
      zoom: z.object({ value: z.number().finite().positive() }),
    })
    .catchall(z.json())
    .parse(value);
  return splitAppState(
    restoreAppState(
      { ...view, zoom: { value: getNormalizedZoom(view.zoom.value) } },
      null,
    ),
  ).view;
};

/** Restores a private, editor-owned recovery record from browser storage. */
export const parseAccountDraft = (value: unknown): AccountDraft => {
  const draft = z
    .object({
      id: drawingId,
      baseRevision: revision,
      draftId: id,
      generation: id,
      updatedAt: timestamp,
      elements: z.array(z.unknown()),
      appState: z.record(z.string(), z.unknown()),
      request: z
        .object({
          requestId: id,
          baseRevision: revision,
          // a retry must resend the bytes the receipt hashed, so restoring
          // the content here would turn the retry into a request id reuse
          content: z.custom<DrawingData["content"]>(
            (value) => contentSchema.safeParse(value).success,
          ),
        })
        .optional(),
    })
    .parse(value);
  const content = contentSchema.parse({
    elements: draft.elements,
    appState: draft.appState,
  });
  return {
    ...draft,
    elements: content.elements,
    appState: { ...content.appState, ...parseView(draft.appState) },
  };
};
