import { z } from "zod";

const id = z.string().min(1).max(256);
const coordinate = z.number().min(-1_000_000).max(1_000_000);
const dimension = z.number().positive().max(10_000);
const text = z.string().max(10_000);
const style = z.strictObject({
  strokeColor: z.string().max(64).optional(),
  backgroundColor: z.string().max(64).optional(),
  fillStyle: z.enum(["solid", "hachure", "cross-hatch"]).optional(),
  strokeWidth: z.number().min(0.5).max(20).optional(),
  strokeStyle: z.enum(["solid", "dashed", "dotted"]).optional(),
  roughness: z.number().min(0).max(2).optional(),
  opacity: z.number().min(0).max(100).optional(),
});

export const operationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("create"),
    id: id.optional(),
    type: z.enum(["rectangle", "ellipse", "diamond", "stickynote"]),
    x: coordinate,
    y: coordinate,
    width: dimension.optional(),
    height: dimension.optional(),
    label: text.optional(),
    style: style.optional(),
  }),
  z.strictObject({
    kind: z.literal("text"),
    id: id.optional(),
    x: coordinate,
    y: coordinate,
    text,
    fontSize: z.number().min(8).max(200).optional(),
  }),
  z.strictObject({ kind: z.literal("move"), id, x: coordinate, y: coordinate }),
  z.strictObject({
    kind: z.literal("resize"),
    id,
    width: dimension,
    height: dimension,
  }),
  z.strictObject({ kind: z.literal("set_label"), id, text }),
  z.strictObject({ kind: z.literal("style"), id, style }),
  z.strictObject({
    kind: z.literal("connect"),
    id: id.optional(),
    fromId: id,
    toId: id,
    label: text.optional(),
  }),
  z.strictObject({ kind: z.literal("delete"), id }),
]);

const document = { documentId: id };
const mutation = {
  ...document,
  baseRevision: z.number().int().nonnegative(),
  requestId: id.describe(
    "Unique ID for this edit. Reuse only to retry the same request.",
  ),
};

export const toolSchemas = {
  get_document: z.strictObject({}),
  apply_operations: z.strictObject({
    ...mutation,
    operations: z.array(operationSchema).min(1).max(100),
  }),
  import_mermaid: z.strictObject({
    ...mutation,
    source: z.string().min(1).max(50_000),
    x: coordinate.default(0),
    y: coordinate.default(0),
  }),
  render_document: z.strictObject({
    ...document,
    maxSize: z.number().int().min(64).max(2048).default(1200),
  }),
  set_view: z.strictObject({
    ...document,
    elementIds: z.array(id).max(100).default([]),
    select: z.boolean().default(true),
  }),
  new_document: z.strictObject({
    ...mutation,
    name: z.string().min(1).max(200),
    replace: z.boolean().default(false),
  }),
  open_document: z.strictObject({
    ...mutation,
    path: z.string().min(1).max(4096),
    replace: z.boolean().default(false),
  }),
  save_document: z.strictObject({
    ...mutation,
    path: z.string().min(1).max(4096),
    overwrite: z.boolean().default(false),
  }),
};

export type Operation = z.infer<typeof operationSchema>;
export type ToolName = keyof typeof toolSchemas;
export type Mutation = z.infer<typeof toolSchemas.apply_operations>;

const descriptions: Record<ToolName, string> = {
  get_document:
    "Read the current drawing, its documentId and revision, selected IDs, shapes, labels and connections. Read before editing. Coordinates are canvas units.",
  apply_operations:
    "Atomically edit the current drawing in one undo step. Operations run in order; supplied IDs can be referenced later in the batch. Move and resize shapes to preserve their labels and connectors. Use set_label to edit text. Existing IDs remain stable. Locked elements are protected.",
  import_mermaid:
    "Append a Mermaid diagram at x,y using the built-in converter. Returns created IDs for subsequent edits. Supported diagram kinds become editable elements; some Mermaid kinds render as images.",
  render_document:
    "Render the current drawing as a PNG image. Use after edits to inspect layout and refine the diagram.",
  set_view:
    "Select and zoom to elementIds. An empty list fits the whole drawing and clears selection.",
  new_document:
    "Start a new named drawing. Requires replace:true if the current drawing is not empty. Save the current drawing first if it should be kept.",
  open_document:
    "Open an absolute .setsquare file path. Requires replace:true if the current drawing is not empty. Save the current drawing first if it should be kept.",
  save_document:
    "Save the current drawing to an absolute .setsquare path. Set overwrite:true to replace an existing file. Returns only after the file has been written.",
};

export const automationTools = Object.entries(toolSchemas).map(
  ([name, schema]) => ({
    name,
    description: descriptions[name as ToolName],
    inputSchema: z.toJSONSchema(schema, { io: "input" }),
    annotations: {
      readOnlyHint: name === "get_document" || name === "render_document",
      destructiveHint: [
        "new_document",
        "open_document",
        "save_document",
        "apply_operations",
      ].includes(name),
      openWorldHint: false,
    },
  }),
);
