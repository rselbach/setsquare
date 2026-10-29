import { z } from "zod";

import {
  authorizationSchema,
  clientMetadataSchema,
  equal,
  hash,
  OAuthError,
  READ_SCOPE,
  SCOPES,
  WRITE_SCOPE,
} from "./oauth-store";

import type { McpOAuthStore } from "./oauth-store";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Authentication, AuthenticatedSession } from "../auth";
import type { ServerConfig } from "../config";

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        character
      ]!),
  );
const field = (name: string, value: string) =>
  `<input type="hidden" name="${name}" value="${escape(value)}">`;
const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(
    title,
  )} · Setsquare</title><style>body{font:17px/1.6 system-ui,sans-serif;max-width:640px;margin:10vh auto;padding:24px;color:#20252b;background:#faf9f6}h1{font-size:28px}button{font:inherit;padding:10px 24px;margin:16px 12px 0 0;border:1px solid #77818b;border-radius:6px;cursor:pointer}button[value=allow]{background:#185ea8;color:white;border-color:#185ea8}small{overflow-wrap:anywhere}section{border-bottom:1px solid #ccc;padding:16px 0}a{color:#185ea8}</style></head><body><p>Setsquare</p><h1>${escape(
    title,
  )}</h1>${body}</body></html>`;

const html = (
  reply: FastifyReply,
  title: string,
  body: string,
  redirectOrigin?: string,
) =>
  reply
    .type("text/html")
    .header(
      "Content-Security-Policy",
      `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'${
        redirectOrigin ? ` ${redirectOrigin}` : ""
      }; base-uri 'none'; frame-ancestors 'none'`,
    )
    .header("X-Frame-Options", "DENY")
    .send(page(title, body));

const formSchema = z.record(z.string(), z.string());

/** Registers the browser consent flow and OAuth endpoints independently of MCP transport. */
export const registerMcpOAuth = async (
  app: FastifyInstance,
  auth: Authentication,
  store: McpOAuthStore,
  config: ServerConfig,
) => {
  const metadata = {
    issuer: config.origin,
    authorization_endpoint: `${config.origin}/oauth/authorize`,
    token_endpoint: `${config.origin}/oauth/token`,
    registration_endpoint: `${config.origin}/oauth/register`,
    revocation_endpoint: `${config.origin}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: [
      "none",
      "client_secret_basic",
      "client_secret_post",
    ],
    revocation_endpoint_auth_methods_supported: [
      "none",
      "client_secret_basic",
      "client_secret_post",
    ],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: SCOPES,
    authorization_response_iss_parameter_supported: true,
  };
  const resource = {
    resource: store.resource,
    resource_name: "Setsquare drawings",
    authorization_servers: [config.origin],
    scopes_supported: SCOPES,
    bearer_methods_supported: ["header"],
  };
  for (const [url, document] of [
    ["/.well-known/oauth-authorization-server", metadata],
    ["/.well-known/oauth-protected-resource", resource],
    ["/.well-known/oauth-protected-resource/mcp", resource],
  ] as const) {
    app.get(url, async (_request, reply) =>
      reply
        .header("Access-Control-Allow-Origin", "*")
        .header("Cache-Control", "no-store")
        .send(document),
    );
  }

  await app.register(
    async (routes) => {
      routes.addContentTypeParser(
        "application/x-www-form-urlencoded",
        { parseAs: "string", bodyLimit: 16_384 },
        (_request, body, done) => {
          const params = new URLSearchParams(String(body));
          const parsed: Record<string, string> = Object.create(null);
          for (const [key, value] of params) {
            if (Object.hasOwn(parsed, key)) {
              done(
                new OAuthError(
                  "invalid_request",
                  "Repeated form parameters are not allowed",
                ),
              );
              return;
            }
            parsed[key] = value;
          }
          done(null, parsed);
        },
      );
      routes.addHook("onRequest", async (request, reply) => {
        reply
          .header("Cache-Control", "no-store")
          .header("Pragma", "no-cache")
          .header("Referrer-Policy", "no-referrer");
        if (
          ["/oauth/register", "/oauth/token", "/oauth/revoke"].includes(
            request.url.split("?")[0],
          )
        ) {
          reply.header("Access-Control-Allow-Origin", "*");
          reply.header("Access-Control-Allow-Methods", "POST, OPTIONS");
          reply.header(
            "Access-Control-Allow-Headers",
            "Authorization, Content-Type",
          );
        }
      });
      routes.setErrorHandler((error, _request, reply) => {
        if (error instanceof OAuthError) {
          if (error.status === 401) {
            reply.header("WWW-Authenticate", 'Basic realm="Setsquare OAuth"');
          }
          return reply
            .status(error.status)
            .send({ error: error.code, error_description: error.message });
        }
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            error: "invalid_request",
            error_description: "Missing or invalid OAuth parameters",
          });
        }
        throw error;
      });

      const session = async (request: FastifyRequest, reply: FastifyReply) => {
        const signedIn = await auth.sessions.find(
          request.cookies[auth.cookieName],
        );
        if (!signedIn) {
          reply.redirect(
            `/api/auth/github?${new URLSearchParams({
              returnTo: request.url,
            })}`,
          );
        }
        return signedIn;
      };
      const verifyConsent = async (
        request: FastifyRequest,
      ): Promise<AuthenticatedSession> => {
        const signedIn = await auth.sessions.find(
          request.cookies[auth.cookieName],
        );
        const body = formSchema.parse(request.body);
        if (
          !signedIn ||
          request.headers.origin !== config.origin ||
          request.headers["sec-fetch-site"] === "cross-site" ||
          !body.csrf_token ||
          !equal(body.csrf_token, signedIn.csrfToken)
        ) {
          throw new OAuthError(
            "access_denied",
            "This approval is not from your signed-in browser",
            403,
          );
        }
        return signedIn;
      };

      const authenticateClient = async (request: FastifyRequest) => {
        const body = formSchema.parse(request.body);
        let id = body.client_id;
        let secret = body.client_secret;
        let method = secret === undefined ? "none" : "client_secret_post";
        if (request.headers.authorization) {
          if (
            secret !== undefined ||
            id !== undefined ||
            !/^Basic [A-Za-z0-9+/]+=*$/i.test(request.headers.authorization)
          ) {
            throw new OAuthError(
              "invalid_client",
              "Use exactly one client authentication method",
              401,
            );
          }
          const encoded = request.headers.authorization.slice(6);
          const credentials = Buffer.from(encoded, "base64").toString("utf8");
          const separator = credentials.indexOf(":");
          if (separator < 0) {
            throw new OAuthError(
              "invalid_client",
              "Invalid client credentials",
              401,
            );
          }
          try {
            id = decodeURIComponent(
              credentials.slice(0, separator).replaceAll("+", " "),
            );
            secret = decodeURIComponent(
              credentials.slice(separator + 1).replaceAll("+", " "),
            );
          } catch {
            throw new OAuthError(
              "invalid_client",
              "Invalid client credentials",
              401,
            );
          }
          method = "client_secret_basic";
        }
        if (!id || id.length > 256) {
          throw new OAuthError(
            "invalid_client",
            "A client ID is required",
            401,
          );
        }
        const client = await store.client(id);
        if (
          client.token_endpoint_auth_method !== method ||
          (method !== "none" &&
            (!secret ||
              !client.secretHash ||
              !equal(hash(secret), client.secretHash)))
        ) {
          throw new OAuthError(
            "invalid_client",
            "Invalid client credentials",
            401,
          );
        }
        return client;
      };

      for (const url of ["/register", "/token", "/revoke"]) {
        routes.options(url, async (_request, reply) =>
          reply.status(204).send(),
        );
      }
      routes.post(
        "/register",
        { bodyLimit: 16_384 },
        async (request, reply) => {
          const parsed = clientMetadataSchema.safeParse(request.body);
          if (!parsed.success) {
            throw new OAuthError(
              "invalid_client_metadata",
              "Invalid client metadata or redirect URIs",
            );
          }
          return reply
            .status(201)
            .send(await store.register(parsed.data, request.ip));
        },
      );
      routes.get("/authorize", async (request, reply) => {
        const input = authorizationSchema.parse(request.query);
        const client = await store.authorize(input);
        const signedIn = await session(request, reply);
        if (!signedIn) {
          return reply;
        }
        const nonce = await store.consent(signedIn, input);
        const write = input.scope.split(" ").includes(WRITE_SCOPE);
        return html(
          reply,
          "Connect an MCP client",
          `<p><strong>${escape(
            client.client_name,
          )}</strong> is requesting access to the Setsquare account <strong>${escape(
            signedIn.user.login,
          )}</strong>.</p><ul><li>Read your drawings, folders, and images.</li>${
            write
              ? "<li>Create and edit drawings, organize folders, and move items to or from the Trash.</li>"
              : ""
          }</ul><p>Allow only clients you trust. The name is provided by the client.</p><p><small>Callback: ${escape(
            input.redirect_uri,
          )}</small></p><form method="post" action="/oauth/authorize">${field(
            "consent",
            nonce,
          )}${field(
            "csrf_token",
            signedIn.csrfToken,
          )}<button name="decision" value="allow">Allow access</button><button name="decision" value="deny">Cancel</button></form><p>You can revoke access at <a href="/oauth/connections">Connected clients</a>.</p>`,
          // Browsers also apply form-action to the post-consent redirect.
          new URL(input.redirect_uri).origin,
        );
      });
      routes.post(
        "/authorize",
        { bodyLimit: 16_384 },
        async (request, reply) => {
          const signedIn = await verifyConsent(request);
          const input = z
            .object({
              consent: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
              decision: z.enum(["allow", "deny"]),
            })
            .parse(request.body);
          return reply
            .code(303)
            .redirect(
              await store.approve(
                signedIn,
                input.consent,
                input.decision === "allow",
              ),
            );
        },
      );
      routes.post("/token", { bodyLimit: 16_384 }, async (request) => {
        const client = await authenticateClient(request);
        const input = z
          .object({
            grant_type: z.enum(["authorization_code", "refresh_token"]),
            resource: z.url().max(2048),
            code: z.string().max(256).optional(),
            redirect_uri: z.string().max(2048).optional(),
            code_verifier: z.string().max(128).optional(),
            refresh_token: z.string().max(256).optional(),
            scope: z.string().max(256).optional(),
          })
          .parse(request.body);
        return store.exchange(client, input);
      });
      routes.post("/revoke", { bodyLimit: 16_384 }, async (request, reply) => {
        const client = await authenticateClient(request);
        const { token } = z
          .object({ token: z.string().min(1).max(1024) })
          .parse(request.body);
        await store.revoke(client.client_id, token);
        return reply.status(200).send({});
      });
      routes.get("/connections", async (request, reply) => {
        const signedIn = await session(request, reply);
        if (!signedIn) {
          return reply;
        }
        const connections = await store.connections(signedIn.user.id);
        return html(
          reply,
          "Connected clients",
          `<p>Signed in as <strong>${escape(
            signedIn.user.login,
          )}</strong>.</p>${
            connections.length
              ? connections
                  .map(
                    (connection) =>
                      `<section><strong>${escape(connection.name)}</strong><p>${
                        connection.scopes.includes(WRITE_SCOPE)
                          ? "Read and edit drawings"
                          : "Read drawings"
                      }</p><form method="post" action="/oauth/connections">${field(
                        "grant_id",
                        connection.id,
                      )}${field(
                        "csrf_token",
                        signedIn.csrfToken,
                      )}<button>Revoke access</button></form></section>`,
                  )
                  .join("")
              : "<p>No connected clients.</p>"
          }<p><a href="/">Back to Setsquare</a></p>`,
        );
      });
      routes.post(
        "/connections",
        { bodyLimit: 16_384 },
        async (request, reply) => {
          const signedIn = await verifyConsent(request);
          const { grant_id: grantId } = z
            .object({ grant_id: z.uuid() })
            .parse(request.body);
          await store.disconnect(signedIn.user.id, grantId);
          return reply.code(303).redirect("/oauth/connections");
        },
      );
    },
    { prefix: "/oauth" },
  );
};

export const challenge = (
  reply: FastifyReply,
  origin: string,
  error?: "invalid_token" | "insufficient_scope",
) =>
  reply
    .header(
      "WWW-Authenticate",
      `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="${READ_SCOPE}${
        error === "insufficient_scope" ? ` ${WRITE_SCOPE}` : ""
      }"${error ? `, error="${error}"` : ""}`,
    )
    .status(error === "insufficient_scope" ? 403 : 401)
    .send({ error: error ?? "unauthorized" });
