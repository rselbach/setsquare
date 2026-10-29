import { stat } from "node:fs/promises";

import cookie from "@fastify/cookie";
import serveStatic from "@fastify/static";
import Fastify, { LogController } from "fastify";
import { z } from "zod";

import { Authentication, GitHubOAuth } from "./auth";

import { ApiError } from "./errors";
import { FileDatabase } from "./files";
import { registerMcp } from "./mcp";
import {
  commandSchema,
  drawingIdSchema,
  filesSchema,
  idsSchema,
} from "./validation";
import { WorkspaceDatabase } from "./workspace";

import type { ServerConfig } from "./config";
import type { OAuthProvider } from "./auth";
import type { Pool } from "pg";

/** The dependencies of one server, including external OAuth for integration tests. */
export type ServerOptions = {
  config: ServerConfig;
  pool: Pool;
  provider?: OAuthProvider | null;
  now?: () => number;
  logger?: boolean;
  cleanup?: boolean;
};

/** Builds the same-origin web and account API server. */
export const buildServer = async ({
  config,
  pool,
  provider,
  now = Date.now,
  logger = false,
  cleanup = true,
}: ServerOptions) => {
  const app = Fastify({
    logger: logger
      ? {
          redact: [
            "req.headers.cookie",
            "req.headers.authorization",
            "req.headers['x-csrf-token']",
            "res.headers['set-cookie']",
          ],
        }
      : false,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 12 * 1024 * 1024,
    requestTimeout: 30_000,
    routerOptions: { maxParamLength: 1024 },
  });
  await app.register(cookie);
  const auth = new Authentication(
    pool,
    config,
    provider === undefined
      ? config.github
        ? new GitHubOAuth(config.origin, config.github)
        : null
      : provider,
    now,
  );
  const workspace = new WorkspaceDatabase(pool, now);
  const files = new FileDatabase(pool, now);
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply
        .status(error.status)
        .send({ error: error.code, message: error.message });
    }
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: "invalid_request",
        message: "The request contains invalid data",
      });
    }
    if (
      error instanceof Error &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      return reply.status(error.statusCode).send({
        error: "invalid_request",
        message:
          error.statusCode === 413
            ? "The request is too large"
            : "The request could not be read",
      });
    }
    // Request URLs may carry OAuth codes, so errors log a request id, not the URL.
    request.log.error({ requestId: request.id, err: error }, "Request failed");
    return reply.status(500).send({
      error: "server_error",
      message: "The server could not finish this request",
    });
  });
  app.addHook("onRequest", async (request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "same-origin");
    if (request.url.startsWith("/api/")) {
      reply.header("Cache-Control", "no-store");
      reply.header("Referrer-Policy", "no-referrer");
    }
  });
  auth.register(app);
  const mcpOAuth = await registerMcp(
    app,
    config,
    pool,
    auth,
    workspace,
    files,
    now,
  );

  app.get("/api/health", async (_request, reply) => {
    try {
      await pool.query("SELECT 1");
      return { ok: true };
    } catch {
      return reply.status(503).send({ ok: false });
    }
  });
  app.get("/api/workspace", async (request) => {
    const session = await auth.require(request);
    return workspace.getSnapshot(session.user.id);
  });
  const getDrawing =
    (opened: boolean) =>
    async (request: Parameters<typeof auth.require>[0]) => {
      const session = await auth.require(request);
      const { id } = z.object({ id: drawingIdSchema }).parse(request.params);
      const drawing = await workspace.getDrawing(session.user.id, id, opened);
      if (!drawing) {
        throw new ApiError(404, "not_found", "The drawing does not exist");
      }
      return drawing;
    };
  app.get("/api/drawings/:id", getDrawing(true));
  app.get("/api/drawings/:id/content", getDrawing(false));
  app.post("/api/commands", async (request) => {
    const session = await auth.require(request, { mutation: true });
    const { requestId, command } = commandSchema.parse(request.body);
    return workspace.command(session.user.id, requestId, command);
  });
  app.get("/api/thumbnails", async (request) => {
    const session = await auth.require(request);
    const { ids } = z.object({ ids: idsSchema }).parse(request.query);
    return { thumbnails: await workspace.getThumbnails(session.user.id, ids) };
  });
  app.get("/api/files", async (request) => {
    const session = await auth.require(request);
    const { ids } = z.object({ ids: idsSchema }).parse(request.query);
    return files.get(session.user.id, ids);
  });
  app.post("/api/files", async (request) => {
    const session = await auth.require(request, { mutation: true });
    const { files: added } = filesSchema.parse(request.body);
    return files.save(session.user.id, added);
  });

  const staticAvailable = await stat(`${config.staticDir}/index.html`).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return false;
      }
      throw error;
    },
  );
  if (staticAvailable) {
    await app.register(serveStatic, {
      root: config.staticDir,
      cacheControl: false,
      setHeaders: (response, filename) => {
        response.header(
          "Cache-Control",
          /\/(assets|fonts)\//.test(filename)
            ? "public, max-age=31536000, immutable"
            : "no-cache",
        );
      },
    });
  }
  app.setNotFoundHandler((request, reply) => {
    const pathname = new URL(request.url, config.origin).pathname;
    if (
      ["/api", "/oauth", "/mcp", "/.well-known"].some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
      )
    ) {
      return reply.status(404).send({
        error: "not_found",
        message: "The API endpoint does not exist",
      });
    }
    if (
      staticAvailable &&
      request.method === "GET" &&
      !/\.[^/]+$/.test(pathname) &&
      request.headers.accept?.includes("text/html")
    ) {
      return reply
        .type("text/html")
        .header("Cache-Control", "no-cache")
        .sendFile("index.html");
    }
    return reply
      .status(404)
      .send({ error: "not_found", message: "The page does not exist" });
  });

  if (cleanup) {
    let collecting = false;
    const collect = async () => {
      if (collecting) {
        return;
      }
      collecting = true;
      try {
        await workspace.collect();
        await mcpOAuth.collect();
      } catch (error) {
        app.log.error(
          { errorName: error instanceof Error ? error.name : "UnknownError" },
          "Workspace cleanup failed",
        );
      } finally {
        collecting = false;
      }
    };
    const interval = setInterval(collect, 60 * 60 * 1000);
    interval.unref();
    app.addHook("onClose", async () => clearInterval(interval));
    await collect();
  }
  return app;
};
