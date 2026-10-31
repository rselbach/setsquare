import { createMcpHandler } from "@modelcontextprotocol/server";

import { challenge, registerMcpOAuth } from "./oauth";
import { McpOAuthStore, READ_SCOPE, WRITE_SCOPE } from "./oauth-store";
import { createWorkspaceMcp, isWriteTool } from "./tools";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import type { AccessGrant } from "./oauth-store";
import type { Authentication } from "../auth";
import type { ServerConfig } from "../config";
import type { FileDatabase } from "../files";
import type { WorkspaceDatabase } from "../workspace";

/** Stateless Streamable HTTP: each request is authenticated and owns its MCP instance. */
export const registerMcp = async (
  app: FastifyInstance,
  config: ServerConfig,
  pool: Pool,
  auth: Authentication,
  workspace: WorkspaceDatabase,
  files: FileDatabase,
  now: () => number,
) => {
  const oauth = new McpOAuthStore(
    pool,
    `${config.origin}/mcp`,
    now,
    config.allowedGithubIds,
  );
  await registerMcpOAuth(app, auth, oauth, config);
  const handler = createMcpHandler(
    (context) => {
      const owner = context.authInfo?.extra?.userId;
      const requestId = context.authInfo?.extra?.requestId;
      if (typeof owner !== "string" || typeof requestId !== "string") {
        throw new Error("MCP requires an authenticated account");
      }
      return createWorkspaceMcp(
        workspace,
        files,
        owner,
        config.origin,
        context.authInfo!.scopes.includes(WRITE_SCOPE),
        app.log,
        requestId,
      );
    },
    { maxRequestBodySize: 12 * 1024 * 1024 },
  );
  app.addHook("onClose", async () => handler.close());
  // Development clients may also reach the API server directly over loopback.
  const allowedHosts = new Set([
    new URL(config.origin).host,
    ...(config.production
      ? []
      : ["localhost", "127.0.0.1", "[::1]"].map(
          (name) => `${name}:${config.port}`,
        )),
  ]);
  const verified = new WeakMap<
    FastifyRequest,
    { token: string; grant: AccessGrant }
  >();
  // Checks run in onRequest, so unauthenticated bodies are never read.
  const authenticate = async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header("Cache-Control", "no-store");
    const allowedOrigins = [config.origin, ...(config.mcpAllowedOrigins ?? [])];
    if (
      request.headers.origin &&
      !allowedOrigins.includes(request.headers.origin)
    ) {
      return reply.status(403).send({ error: "forbidden_origin" });
    }
    // Use the configured public origin; forwarded headers never choose token audiences.
    const host = request.headers.host;
    if (!host || !allowedHosts.has(host)) {
      return reply.status(403).send({ error: "forbidden_host" });
    }
    if (request.headers.origin) {
      reply
        .header("Access-Control-Allow-Origin", request.headers.origin)
        .header("Vary", "Origin");
      reply.header(
        "Access-Control-Expose-Headers",
        "WWW-Authenticate, MCP-Protocol-Version",
      );
    }
    if (request.method === "OPTIONS") {
      return reply
        .header("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS")
        .header(
          "Access-Control-Allow-Headers",
          "Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id, Mcp-Method, Mcp-Name",
        )
        .status(204)
        .send();
    }
    const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(
      request.headers.authorization ?? "",
    );
    if (!bearer) {
      return challenge(
        reply,
        config.origin,
        request.headers.authorization ? "invalid_token" : undefined,
      );
    }
    const grant = await oauth.verify(bearer[1]);
    if (!grant) {
      return challenge(reply, config.origin, "invalid_token");
    }
    verified.set(request, { token: bearer[1], grant });
  };
  app.all(
    "/mcp",
    { bodyLimit: 12 * 1024 * 1024, onRequest: authenticate },
    async (request, reply) => {
      const { token, grant } = verified.get(request)!;
      const body = request.body as {
        method?: string;
        params?: { name?: string };
      } | null;
      if (
        !grant.scopes.includes(READ_SCOPE) ||
        (body?.method === "tools/call" &&
          typeof body.params?.name === "string" &&
          isWriteTool(body.params.name) &&
          !grant.scopes.includes(WRITE_SCOPE))
      ) {
        return challenge(reply, config.origin, "insufficient_scope");
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (value !== undefined) {
          headers.set(name, Array.isArray(value) ? value.join(", ") : value);
        }
      }
      const response = await handler.fetch(
        new Request(`${config.origin}/mcp`, {
          method: request.method,
          headers,
        }),
        {
          parsedBody: request.body,
          authInfo: {
            token,
            clientId: grant.client_id,
            scopes: grant.scopes,
            resource: new URL(grant.resource),
            expiresAt: Math.floor(Number(grant.access_expires_at) / 1000),
            extra: { userId: grant.user_id, requestId: request.id },
          },
        },
      );
      return reply.send(response);
    },
  );
  return oauth;
};
