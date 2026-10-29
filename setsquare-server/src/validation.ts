import { z } from "zod";

import type {
  FileId,
  FractionalIndex,
  NonDeletedSetsquareElement,
  SetsquareTextElement,
} from "@setsquare/element/types";
import type { LocalPoint, Radians } from "@setsquare/math";
import type { BinaryFileData, DataURL } from "@setsquare/setsquare/types";

import type { WorkspaceCommand } from "../../setsquare-app/workspace/api";
import type {
  DrawingContent,
  DrawingId,
  FolderId,
} from "../../setsquare-app/workspace/types";

const id = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/);
const drawingId = id.transform((value) => value as DrawingId);
const folderId = id.transform((value) => value as FolderId);
const fileId = id.transform((value) => value as FileId);
const parentId = folderId.nullable();
const name = z.string().trim().min(1).max(256);
const drawingName = z.string().max(256).nullable();
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const coordinate = z.number().finite().min(-1e12).max(1e12);
const point = z.tuple([coordinate, coordinate]);
const binding = z
  .object({
    elementId: id,
    fixedPoint: point,
    mode: z.enum(["inside", "orbit", "skip"]),
  })
  .nullable();
const arrowhead = z
  .enum([
    "arrow",
    "bar",
    "circle",
    "circle_outline",
    "triangle",
    "triangle_outline",
    "diamond",
    "diamond_outline",
    "cardinality_one",
    "cardinality_many",
    "cardinality_one_or_many",
    "cardinality_exactly_one",
    "cardinality_zero_or_one",
    "cardinality_zero_or_many",
  ])
  .nullable();

const jsonDocument = (value: unknown): boolean => {
  const pending = [{ value, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const current = pending.pop();
    if (!current || ++count > 1_000_000 || current.depth > 64) {
      return false;
    }
    const item = current.value;
    if (
      item === null ||
      typeof item === "string" ||
      typeof item === "boolean"
    ) {
      continue;
    }
    if (typeof item === "number" && Number.isFinite(item)) {
      continue;
    }
    if (typeof item !== "object" || !item) {
      return false;
    }
    for (const child of Object.values(item)) {
      pending.push({ value: child, depth: current.depth + 1 });
    }
  }
  return true;
};

const baseElement = z.looseObject({
  id,
  x: coordinate,
  y: coordinate,
  width: coordinate.nonnegative(),
  height: coordinate.nonnegative(),
  angle: coordinate.transform((value) => value as Radians),
  strokeColor: z.string().max(128),
  backgroundColor: z.string().max(128),
  fillStyle: z.enum(["hachure", "cross-hatch", "solid", "zigzag"]),
  strokeWidth: z.number().finite().nonnegative(),
  strokeStyle: z.enum(["solid", "dashed", "dotted"]),
  roundness: z
    .object({
      type: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      value: z.number().finite().optional(),
    })
    .nullable(),
  roughness: z.number().finite(),
  opacity: z.number().min(0).max(100),
  seed: z.number().int(),
  version: revision,
  versionNonce: z.number().int(),
  index: z
    .string()
    .max(256)
    .transform((value) => value as FractionalIndex)
    .nullable(),
  isDeleted: z.literal(false),
  groupIds: z.array(id).max(1000),
  frameId: id.nullable(),
  boundElements: z
    .array(z.object({ id, type: z.enum(["arrow", "text"]) }))
    .max(50_000)
    .nullable(),
  updated: timestamp,
  created: timestamp.nullable(),
  link: z.string().max(10000).nullable(),
  locked: z.boolean(),
});
const element = z
  .discriminatedUnion("type", [
    baseElement.extend({
      type: z.enum([
        "selection",
        "rectangle",
        "diamond",
        "ellipse",
        "iframe",
        "embeddable",
      ]),
    }),
    baseElement.extend({
      type: z.literal("stickynote"),
      baseHeight: coordinate.nonnegative(),
    }),
    baseElement.extend({
      type: z.enum(["frame", "magicframe"]),
      name: drawingName,
    }),
    baseElement.extend({
      type: z.literal("text"),
      fontSize: z.number().positive(),
      fontFamily: z.number().int(),
      baseFontSize: z.number().positive().nullable(),
      text: z.string().max(1_000_000),
      textAlign: z.enum(["left", "center", "right"]),
      verticalAlign: z.enum(["top", "middle", "bottom"]),
      containerId: id.nullable(),
      originalText: z.string().max(1_000_000),
      autoResize: z.boolean(),
      lineHeight: z
        .number()
        .positive()
        .transform((value) => value as SetsquareTextElement["lineHeight"]),
      labelPosition: z.number().nullable().optional(),
    }),
    baseElement.extend({
      type: z.enum(["line", "arrow"]),
      points: z
        .array(point.transform((value) => value as LocalPoint))
        .max(100_000),
      startBinding: binding,
      endBinding: binding,
      startArrowhead: arrowhead,
      endArrowhead: arrowhead,
    }),
    baseElement.extend({
      type: z.literal("freedraw"),
      points: z
        .array(point.transform((value) => value as LocalPoint))
        .max(100_000),
      pressures: z.array(z.number().finite()).max(100_000),
      simulatePressure: z.boolean(),
      strokeOptions: z.object({
        variability: z.enum(["variable", "constant"]),
        streamline: z.number().finite(),
      }),
    }),
    baseElement.extend({
      type: z.literal("image"),
      fileId: fileId.nullable(),
      status: z.enum(["pending", "saved", "error"]),
      scale: point,
      crop: z
        .object({
          x: coordinate,
          y: coordinate,
          width: coordinate.nonnegative(),
          height: coordinate.nonnegative(),
          naturalWidth: coordinate.nonnegative(),
          naturalHeight: coordinate.nonnegative(),
        })
        .nullable(),
    }),
  ])
  .transform((value) => value as NonDeletedSetsquareElement);
const content = z
  .unknown()
  .refine(jsonDocument, "Content must be bounded JSON")
  .pipe(
    z.strictObject({
      elements: z
        .array(element)
        .max(50_000)
        .refine(
          (elements) =>
            new Set(elements.map((item) => item.id)).size === elements.length,
          "Element ids must be unique",
        ),
      appState: z.strictObject({
        name: drawingName,
        viewBackgroundColor: z.string().max(128),
        gridSize: z.number().finite().positive(),
        gridStep: z.number().finite().positive(),
        gridModeEnabled: z.boolean(),
        lockedMultiSelections: z.record(z.string(), z.literal(true)),
      }),
    }),
  )
  .transform((value): DrawingContent => value);
const item = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("folder"), id: folderId }),
  z.strictObject({ kind: z.literal("drawing"), id: drawingId }),
]);
const folder = z.strictObject({
  id: folderId,
  name,
  parentId,
  createdAt: timestamp,
  updatedAt: timestamp,
  trashedAt: timestamp.nullable(),
});
const meta = z.strictObject({
  id: drawingId,
  name: drawingName,
  folderId: parentId,
  createdAt: timestamp,
  updatedAt: timestamp,
  openedAt: timestamp.nullable(),
  trashedAt: timestamp.nullable(),
  revision,
  fileIds: z.array(fileId).max(1000),
});
const thumbnail = z.strictObject({
  src: z
    .string()
    .max(2_000_000)
    .regex(/^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/]+=*$/)
    .transform((value) => value as DataURL),
  revision,
});
const command = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("createFolder"),
    id: folderId,
    parentId,
    name,
  }),
  z.strictObject({ kind: z.literal("renameFolder"), id: folderId, name }),
  z.strictObject({
    kind: z.literal("createDrawing"),
    id: drawingId,
    folderId: parentId,
    name: drawingName,
    content,
    fileIds: z.array(fileId).max(1000),
  }),
  z.strictObject({
    kind: z.literal("duplicateDrawing"),
    sourceId: drawingId,
    id: drawingId,
    name: drawingName,
  }),
  z.strictObject({
    kind: z.literal("renameDrawing"),
    id: drawingId,
    name: drawingName,
    baseRevision: revision,
  }),
  z.strictObject({
    kind: z.literal("saveDrawing"),
    id: drawingId,
    content,
    fileIds: z.array(fileId).max(1000),
    baseRevision: revision,
  }),
  z.strictObject({
    kind: z.literal("saveThumbnail"),
    id: drawingId,
    thumbnail,
  }),
  z.strictObject({ kind: z.literal("deleteThumbnail"), id: drawingId }),
  z.strictObject({ kind: z.literal("move"), item, target: parentId }),
  z.strictObject({ kind: z.enum(["trash", "restore", "deleteForever"]), item }),
  z.strictObject({ kind: z.literal("emptyTrash") }),
  z.strictObject({ kind: z.literal("importFolder"), folder }),
  z.strictObject({
    kind: z.literal("importDrawing"),
    drawing: z.strictObject({ meta, content }),
  }),
]);

/** Validates one workspace command before it reaches storage. */
export const commandSchema = z.strictObject({
  requestId: id,
  command: command.transform((value): WorkspaceCommand => value),
});

/** The supported JSON image upload with an account-local file id. */
export const filesSchema = z.strictObject({
  files: z
    .array(
      z
        .strictObject({
          id: fileId,
          mimeType: z.enum([
            "image/png",
            "image/jpeg",
            "image/jfif",
            "image/webp",
            "image/gif",
            "image/svg+xml",
            "image/avif",
            "image/bmp",
            "image/x-icon",
            "application/octet-stream",
          ]),
          dataURL: z
            .string()
            .max(8_000_000)
            .regex(/^data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]+=*$/i)
            .transform((value) => value as DataURL),
          created: timestamp,
          lastRetrieved: timestamp.optional(),
          version: z.number().int().positive().max(2147483647).optional(),
        })
        .transform((value): BinaryFileData => value),
    )
    .max(100),
});

/** Validates file ids in a query without allowing an unbounded batch. */
export const idsSchema = z
  .string()
  .max(26000)
  .transform((value) => (value ? value.split(",") : []))
  .pipe(z.array(id).max(100));

/** Validates the drawing id decoded by the HTTP router. */
export const drawingIdSchema = drawingId;

/** Validates stored metadata when it crosses the database boundary. */
export const folderSchema = folder;

/** Validates stored drawing metadata when it crosses the database boundary. */
export const drawingMetaSchema = meta;

/** Validates stored drawing content when it crosses the database boundary. */
export const contentSchema = content;

/** Validates stored thumbnails before serving them. */
export const thumbnailSchema = thumbnail;
