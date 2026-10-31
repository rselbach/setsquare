import { z } from "zod";

import type { BinaryFileData } from "@setsquare/setsquare/types";

import { payloadHash } from "../../../setsquare-server/src/canonical";
import { ApiError } from "../../../setsquare-server/src/errors";
import { checkFiles, imageBytes } from "../../../setsquare-server/src/images";
import {
  commandSchema,
  drawingIdSchema,
  filesSchema,
  idsSchema,
} from "../../../setsquare-server/src/validation";

import type {
  CommandResponse,
  CommandResult,
  DrawingData,
  SessionInfo,
  WorkspaceCommand,
  WorkspaceData,
} from "../../workspace/api";
import type {
  DrawingContent,
  DrawingId,
  DrawingMeta,
  ItemRef,
  ParentId,
  Thumbnail,
} from "../../workspace/types";

/**
 * What a request meets before the server sees it: a dropped connection, a
 * request that settles only when aborted, a response lost after the server
 * applied it, or an error status from a proxy.
 */
export type Fault =
  "offline" | "stall" | "lost-response" | { status: number; error: string };

type StoredDrawing = {
  meta: DrawingMeta;
  content: DrawingContent;
  thumbnail: Thumbnail | null;
};
type StoredImage = { file: BinaryFileData; size: number };

const BODY_LIMIT = 12 * 1024 * 1024;
const OK = { ok: true } as const;
const NOT_FOUND = { ok: false, reason: "notFound" } as const;

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const named = (content: DrawingContent, name: string | null) => ({
  ...content,
  appState: { ...content.appState, name },
});

/**
 * An in-memory account server for one signed-in user. It parses requests with
 * the server's own schemas and applies the server's rules for sessions,
 * revisions, receipts and images, without its folders or imports. Pass
 * `fetch` and `session` to `RemoteWorkspaceStore.open`.
 */
export const fakeAccountServer = ({
  userId,
  now = Date.now,
  fileBudget = 16 * 1024 * 1024,
}: {
  userId: string;
  now?: () => number;
  /** raw image bytes per image read, unless one image is larger on its own */
  fileBudget?: number;
}) => {
  const session: Extract<SessionInfo, { kind: "signedIn" }> = {
    kind: "signedIn",
    user: {
      id: userId,
      login: "troy-barnes",
      name: "Troy Barnes",
      avatarUrl: "https://avatars.githubusercontent.com/u/1",
    },
    csrfToken: `${userId}-csrf`,
  };
  let csrfToken = session.csrfToken;
  let signedIn = true;
  const drawings = new Map<string, StoredDrawing>();
  const images = new Map<string, StoredImage>();
  const receipts = new Map<string, { hash: string; result: CommandResult }>();
  const faults: Array<{ route: string; fault: Fault }> = [];
  const commands: Array<{ requestId: string; command: WorkspaceCommand }> = [];

  const snapshot = (): WorkspaceData => ({
    folders: [],
    drawings: [...drawings.values()]
      .map(({ meta }) => meta)
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
  });

  const authenticate = (headers: Headers, mutation: boolean) => {
    if (!signedIn) {
      throw new ApiError(401, "unauthenticated", "Sign in to access");
    }
    if (headers.get("X-Setsquare-Account") !== userId) {
      throw new ApiError(401, "account_changed", "The account changed");
    }
    if (mutation && headers.get("X-CSRF-Token") !== csrfToken) {
      throw new ApiError(403, "csrf_failed", "Refresh this page");
    }
  };

  const requireImages = (fileIds: readonly string[]) => {
    if (fileIds.some((id) => !images.has(id))) {
      throw new ApiError(400, "missing_files", "Upload every image first");
    }
  };

  const insertDrawing = (
    { id, name }: { id: DrawingId; name: string | null },
    content: DrawingContent,
    folderId: ParentId,
    fileIds: readonly string[],
  ): CommandResult => {
    if (folderId !== null) {
      throw new ApiError(404, "not_found", "The folder does not exist");
    }
    requireImages(fileIds);
    const at = now();
    const meta: DrawingMeta = {
      id,
      name,
      folderId,
      createdAt: at,
      updatedAt: at,
      openedAt: null,
      trashedAt: null,
      revision: 1,
      fileIds: fileIds as DrawingMeta["fileIds"],
    };
    drawings.set(id, { meta, content: named(content, name), thumbnail: null });
    return { kind: "drawing", drawing: meta };
  };

  const changeItem = (
    kind: "trash" | "restore" | "deleteForever",
    item: ItemRef,
  ): CommandResult => {
    const stored = item.kind === "drawing" ? drawings.get(item.id) : null;
    if (!stored) {
      return { kind: "change", result: NOT_FOUND };
    }
    if (kind === "deleteForever") {
      drawings.delete(item.id);
      return { kind: "change", result: OK };
    }
    stored.meta = {
      ...stored.meta,
      trashedAt: kind === "trash" ? (stored.meta.trashedAt ?? now()) : null,
    };
    return { kind: "change", result: OK };
  };

  // checks run before any change, as the server's transaction rolls back
  const apply = (command: WorkspaceCommand): CommandResult => {
    switch (command.kind) {
      case "createDrawing": {
        if (drawings.has(command.id)) {
          throw new ApiError(409, "id_exists", "That drawing id exists");
        }
        const fileIds = checkFiles(command.content, command.fileIds);
        return insertDrawing(
          command,
          command.content,
          command.folderId,
          fileIds,
        );
      }
      case "duplicateDrawing": {
        const source = drawings.get(command.sourceId);
        if (!source) {
          return { kind: "drawing", drawing: null };
        }
        if (drawings.has(command.id)) {
          throw new ApiError(409, "id_exists", "That drawing id exists");
        }
        return insertDrawing(
          command,
          source.content,
          source.meta.folderId,
          source.meta.fileIds,
        );
      }
      case "saveDrawing":
      case "renameDrawing": {
        const stored = drawings.get(command.id);
        if (!stored) {
          return { kind: "save", result: NOT_FOUND };
        }
        if (stored.meta.revision !== command.baseRevision) {
          return {
            kind: "save",
            result: { ok: false, reason: "conflict", meta: stored.meta },
          };
        }
        const saving = command.kind === "saveDrawing";
        const name =
          (saving ? command.content.appState.name : command.name) || null;
        const fileIds = saving
          ? checkFiles(command.content, command.fileIds)
          : stored.meta.fileIds;
        requireImages(fileIds);
        stored.content = named(saving ? command.content : stored.content, name);
        stored.meta = {
          ...stored.meta,
          name,
          updatedAt: now(),
          revision: stored.meta.revision + 1,
          fileIds: fileIds as DrawingMeta["fileIds"],
        };
        return { kind: "save", result: { ok: true, meta: stored.meta } };
      }
      case "saveThumbnail": {
        const stored = drawings.get(command.id);
        if (stored?.meta.revision === command.thumbnail.revision) {
          stored.thumbnail = command.thumbnail;
        }
        return { kind: "change", result: stored ? OK : NOT_FOUND };
      }
      case "deleteThumbnail": {
        const stored = drawings.get(command.id);
        if (stored) {
          stored.thumbnail = null;
        }
        return { kind: "done" };
      }
      case "move": {
        const stored =
          command.item.kind === "drawing"
            ? drawings.get(command.item.id)
            : null;
        if (!stored || command.target !== null || stored.meta.trashedAt) {
          return { kind: "move", result: NOT_FOUND };
        }
        return { kind: "move", result: OK };
      }
      case "trash":
      case "restore":
      case "deleteForever":
        return changeItem(command.kind, command.item);
      case "emptyTrash":
        for (const [id, { meta }] of drawings) {
          if (meta.trashedAt !== null) {
            drawings.delete(id);
          }
        }
        return { kind: "done" };
      case "renameFolder":
        return { kind: "change", result: NOT_FOUND };
      case "createFolder":
      case "importFolder":
      case "importDrawing":
        throw new Error(`The fake account server has no ${command.kind}`);
    }
  };

  const command = (body: unknown): CommandResponse => {
    const { requestId, command } = commandSchema.parse(body);
    commands.push({ requestId, command });
    const hash = payloadHash(command);
    const receipt = receipts.get(requestId);
    if (receipt && receipt.hash !== hash) {
      throw new ApiError(409, "request_reused", "That request id was used");
    }
    const result = receipt?.result ?? apply(command);
    receipts.set(requestId, { hash, result });
    return { result, snapshot: snapshot() };
  };

  const getFiles = (query: unknown) => {
    const { ids } = z.object({ ids: idsSchema }).parse(query);
    const requested = [...new Set(ids)];
    if (requested.some((id) => !images.has(id))) {
      throw new ApiError(404, "not_found", "An image does not exist");
    }
    let total = 0;
    let count = 0;
    for (const id of requested) {
      total += images.get(id)!.size;
      if (count && total > fileBudget) {
        break;
      }
      count++;
    }
    const files = requested.slice(0, count).map((id) => {
      const stored = images.get(id)!;
      stored.file = { ...stored.file, lastRetrieved: now() };
      return stored.file;
    });
    return { files, remaining: requested.slice(count) };
  };

  const saveFiles = (body: unknown) => {
    const { files } = filesSchema.parse(body);
    if (new Set(files.map((file) => file.id)).size !== files.length) {
      throw new ApiError(400, "duplicate_files", "An image id repeats");
    }
    const uploads = files.map((file) => ({ file, bytes: imageBytes(file) }));
    const writes: Array<[string, StoredImage]> = [];
    for (const { file, bytes } of uploads) {
      const existing = images.get(file.id);
      const version = file.version ?? 1;
      if (
        existing?.file.mimeType === file.mimeType &&
        existing.file.dataURL === file.dataURL
      ) {
        writes.push([
          file.id,
          {
            ...existing,
            file: {
              ...existing.file,
              lastRetrieved: now(),
              version: Math.max(existing.file.version ?? 1, version),
            },
          },
        ]);
        continue;
      }
      if (existing && version <= (existing.file.version ?? 1)) {
        throw new ApiError(409, "image_collision", "That version differs");
      }
      writes.push([
        file.id,
        {
          file: {
            id: file.id,
            mimeType: file.mimeType,
            dataURL: file.dataURL,
            created: existing?.file.created ?? file.created,
            lastRetrieved: now(),
            version,
          },
          size: bytes.length,
        },
      ]);
    }
    for (const [id, stored] of writes) {
      images.set(id, stored);
    }
    return { files };
  };

  const getThumbnails = (query: unknown) => {
    const { ids } = z.object({ ids: idsSchema }).parse(query);
    if (ids.some((id) => !drawings.has(id))) {
      throw new ApiError(404, "not_found", "A drawing does not exist");
    }
    return {
      thumbnails: [...new Set(ids)].flatMap((id) => {
        const { thumbnail } = drawings.get(id)!;
        return thumbnail ? [[id, thumbnail]] : [];
      }),
    };
  };

  const getDrawing = (encodedId: string, opened: boolean): DrawingData => {
    const id = drawingIdSchema.parse(decodeURIComponent(encodedId));
    const stored = drawings.get(id);
    if (!stored) {
      throw new ApiError(404, "not_found", "The drawing does not exist");
    }
    if (opened) {
      stored.meta = { ...stored.meta, openedAt: now() };
    }
    return { meta: stored.meta, content: stored.content };
  };

  const route = (
    method: string,
    url: URL,
    headers: Headers,
    body: string,
  ): unknown => {
    const mutation = method === "POST";
    authenticate(headers, mutation);
    if (mutation && new TextEncoder().encode(body).length > BODY_LIMIT) {
      throw new ApiError(413, "invalid_request", "The request is too large");
    }
    const parsed = (): unknown => {
      try {
        return JSON.parse(body);
      } catch {
        throw new ApiError(400, "invalid_request", "Unreadable request");
      }
    };
    const drawing = /^\/api\/drawings\/([^/]+)(\/content)?$/.exec(url.pathname);
    switch (`${method} ${drawing ? "/api/drawings/:id" : url.pathname}`) {
      case "GET /api/workspace":
        return snapshot();
      case "GET /api/drawings/:id":
        return getDrawing(drawing![1], !drawing![2]);
      case "POST /api/commands":
        return command(parsed());
      case "GET /api/thumbnails":
        return getThumbnails(Object.fromEntries(url.searchParams));
      case "GET /api/files":
        return getFiles(Object.fromEntries(url.searchParams));
      case "POST /api/files":
        return saveFiles(parsed());
    }
    throw new ApiError(404, "not_found", "The API endpoint does not exist");
  };

  const respond = (
    method: string,
    url: URL,
    headers: Headers,
    body: string,
  ) => {
    try {
      return json(route(method, url, headers, body));
    } catch (error) {
      if (error instanceof ApiError) {
        return json(
          { error: error.code, message: error.message },
          error.status,
        );
      }
      if (error instanceof z.ZodError) {
        return json({ error: "invalid_request", message: "Invalid data" }, 400);
      }
      throw error;
    }
  };

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const method = init?.method ?? "GET";
    const url = new URL(String(input), "http://localhost");
    const index = faults.findIndex(
      ({ route }) => route === `${method} ${url.pathname}`,
    );
    const fault = index < 0 ? null : faults.splice(index, 1)[0].fault;
    if (fault === "offline") {
      throw new TypeError("Failed to fetch");
    }
    if (fault === "stall") {
      return new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason),
        ),
      );
    }
    if (typeof fault === "object" && fault) {
      return json({ error: fault.error }, fault.status);
    }
    const response = respond(
      method,
      url,
      new Headers(init?.headers),
      typeof init?.body === "string" ? init.body : "",
    );
    if (fault === "lost-response") {
      throw new TypeError("The response was lost after the server applied it");
    }
    return response;
  };

  return {
    session,
    fetch,
    /** commands that passed authentication and validation, replays included */
    commands,
    /** the stored drawing, as the server would serve it */
    drawing: (id: string) => structuredClone(drawings.get(id) ?? null),
    /** the stored image, as the server would serve it */
    image: (id: string) => structuredClone(images.get(id)?.file ?? null),
    /** applies the fault to the next request for `METHOD /path` */
    failNext: (route: string, fault: Fault) => {
      faults.push({ route, fault });
    },
    /** ends the session, so every request answers 401 unauthenticated */
    expireSession: () => {
      signedIn = false;
    },
    /** issues a new CSRF token, so the browser's mutations answer 403 */
    rotateCsrfToken: () => {
      csrfToken = `${csrfToken}-rotated`;
    },
  };
};
