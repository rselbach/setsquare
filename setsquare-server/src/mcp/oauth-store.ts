import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { isIPv6 } from "node:net";

import { z } from "zod";

import { transaction } from "../database";

import type { Pool, PoolClient } from "pg";
import type { AuthenticatedSession } from "../auth";

export const READ_SCOPE = "drawings:read";
export const WRITE_SCOPE = "drawings:write";
export const SCOPES = [READ_SCOPE, WRITE_SCOPE];
const MINUTE = 60_000;
const GRANT_MS = 30 * 24 * 60 * MINUTE;
const ACCESS_MS = 15 * MINUTE;

export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const token = () => randomBytes(32).toString("base64url");
export const equal = (a: string, b: string) =>
  timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));

/**
 * The address a registration counts against: IPv4-mapped addresses as IPv4,
 * and other IPv6 addresses by their /64, since one host can usually use any
 * address in its /64.
 */
export const registrationSource = (ip: string) => {
  if (!isIPv6(ip)) {
    return ip;
  }
  const [address] = ip.toLowerCase().split("%");
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(address);
  const hex = dotted
    ? address.slice(0, dotted.index) +
      [1, 3]
        .map((i) =>
          ((Number(dotted[i]) << 8) | Number(dotted[i + 1])).toString(16),
        )
        .join(":")
    : address;
  const [head, tail] = hex.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const words = [
    ...left,
    ...Array(8 - left.length - right.length).fill("0"),
    ...right,
  ].map((group) => parseInt(group, 16));
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    return [words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255].join(
      ".",
    );
  }
  return `${words
    .slice(0, 4)
    .map((word) => word.toString(16))
    .join(":")}::/64`;
};

export class OAuthError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
  }
}

export const redirectUriSchema = z
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return (
      // Reject control characters before URL parsing can silently normalize them.
      // eslint-disable-next-line no-control-regex
      !/[\u0000-\u0020\u007f]/.test(value) &&
      value.isWellFormed() &&
      !url.hash &&
      !url.username &&
      !url.password &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)))
    );
  }, "Redirect URIs must use HTTPS, or HTTP on loopback, without fragments or credentials");

export const clientMetadataSchema = z
  .object({
    client_name: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((value) => !value.includes("\0"))
      .transform((value) => value.toWellFormed())
      .default("MCP client"),
    redirect_uris: z.array(redirectUriSchema).min(1).max(10),
    token_endpoint_auth_method: z
      .enum(["none", "client_secret_post", "client_secret_basic"])
      .default("client_secret_basic"),
    grant_types: z
      .array(z.enum(["authorization_code", "refresh_token"]))
      .min(1)
      .max(2)
      .default(["authorization_code", "refresh_token"]),
    response_types: z.array(z.literal("code")).length(1).default(["code"]),
  })
  .refine((value) => value.grant_types.includes("authorization_code"));

export const authorizationSchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1).max(256),
  redirect_uri: redirectUriSchema,
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code_challenge_method: z.literal("S256"),
  resource: z.url().max(2048),
  scope: z.string().max(256).default(READ_SCOPE),
  state: z
    .string()
    .max(512)
    .refine((value) => !value.includes("\0"))
    .optional(),
});
export type Authorization = z.infer<typeof authorizationSchema>;
export const consentSchema = z
  .object({ consent: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
  .and(
    z.discriminatedUnion("decision", [
      z.object({
        decision: z.literal("allow"),
        scope: z.string().min(1).max(256),
      }),
      z.object({ decision: z.literal("deny") }),
    ]),
  );
type ClientMetadata = z.infer<typeof clientMetadataSchema>;
export type RegisteredClient = ClientMetadata & {
  client_id: string;
  secretHash: string | null;
};
type Grant = {
  id: string;
  user_id: string;
  client_id: string;
  resource: string;
  scopes: string[];
  expires_at: string;
  revoked_at: string | null;
};
export type AccessGrant = Grant & { access_expires_at: string };

export const parseScopes = (value: string) => {
  const scopes = [...new Set(value.split(" ").filter(Boolean))];
  if (
    !scopes.includes(READ_SCOPE) ||
    scopes.some((scope) => !SCOPES.includes(scope))
  ) {
    throw new OAuthError(
      "invalid_scope",
      `Request ${READ_SCOPE}, optionally with ${WRITE_SCOPE}`,
    );
  }
  return scopes;
};

/** Durable OAuth grants; raw bearer tokens and client secrets are never stored. */
export class McpOAuthStore {
  constructor(
    readonly pool: Pool,
    readonly resource: string,
    readonly now: () => number = Date.now,
    readonly allowedGithubIds: string[] | null = null,
  ) {}

  async register(metadata: ClientMetadata, ip: string) {
    const id = randomUUID();
    const secret =
      metadata.token_endpoint_auth_method === "none" ? undefined : token();
    await transaction(this.pool, async (db) => {
      const ipHash = hash(registrationSource(ip));
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `mcp-register:${ipHash}`,
      ]);
      const recent = await db.query(
        "SELECT count(*)::int AS count FROM mcp_clients WHERE registration_ip_hash = $1 AND created_at > $2",
        [ipHash, this.now() - 60 * MINUTE],
      );
      if (recent.rows[0].count >= 30) {
        throw new OAuthError(
          "temporarily_unavailable",
          "Too many client registrations. Try again later",
          429,
        );
      }
      await db.query(
        "INSERT INTO mcp_clients(id, metadata, secret_hash, registration_ip_hash, created_at) VALUES($1,$2,$3,$4,$5)",
        [id, metadata, secret ? hash(secret) : null, ipHash, this.now()],
      );
    });
    return {
      ...metadata,
      client_id: id,
      client_id_issued_at: Math.floor(this.now() / 1000),
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    };
  }

  async client(id: string): Promise<RegisteredClient> {
    const result = await this.pool.query(
      "SELECT metadata, secret_hash FROM mcp_clients WHERE id = $1",
      [id],
    );
    if (!result.rows.length) {
      throw new OAuthError("invalid_client", "Unknown OAuth client");
    }
    return {
      ...clientMetadataSchema.parse(result.rows[0].metadata),
      client_id: id,
      secretHash: result.rows[0].secret_hash,
    };
  }

  checkResource(value: string) {
    if (new URL(value).href !== this.resource) {
      throw new OAuthError(
        "invalid_target",
        "The resource must be this server's /mcp URL",
      );
    }
  }

  async authorize(input: Authorization) {
    const client = await this.client(input.client_id);
    // Do not redirect errors until the client and exact redirect URI are verified.
    if (!client.redirect_uris.includes(input.redirect_uri)) {
      throw new OAuthError(
        "invalid_request",
        "The redirect URI is not registered for this client",
      );
    }
    this.checkResource(input.resource);
    parseScopes(input.scope);
    return client;
  }

  async consent(session: AuthenticatedSession, request: Authorization) {
    const nonce = token();
    await this.pool.query(
      "INSERT INTO mcp_consents(token_hash, user_id, session_hash, client_id, request, expires_at) VALUES($1,$2,$3,$4,$5,$6)",
      [
        hash(nonce),
        session.user.id,
        session.tokenHash,
        request.client_id,
        request,
        this.now() + 10 * MINUTE,
      ],
    );
    return nonce;
  }

  async approve(
    session: AuthenticatedSession,
    input: z.infer<typeof consentSchema>,
  ) {
    return transaction(this.pool, async (db) => {
      const pending = await db.query(
        "DELETE FROM mcp_consents WHERE token_hash = $1 AND user_id = $2 AND session_hash = $3 AND expires_at > $4 RETURNING request",
        [hash(input.consent), session.user.id, session.tokenHash, this.now()],
      );
      if (!pending.rows.length) {
        throw new OAuthError(
          "invalid_request",
          "This approval expired. Connect again from your MCP client",
        );
      }
      const request = authorizationSchema.parse(pending.rows[0].request);
      const redirect = new URL(request.redirect_uri);
      if (request.state !== undefined) {
        redirect.searchParams.set("state", request.state);
      }
      redirect.searchParams.set("iss", new URL(this.resource).origin);
      if (input.decision === "deny") {
        redirect.searchParams.set("error", "access_denied");
        return redirect.href;
      }
      const scopes = parseScopes(input.scope);
      const requested = parseScopes(request.scope);
      if (scopes.some((scope) => !requested.includes(scope))) {
        throw new OAuthError(
          "invalid_scope",
          "Granted permissions must be requested by the client",
        );
      }
      await db.query(
        "UPDATE mcp_clients SET authorized_at = $2 WHERE id = $1 AND authorized_at IS NULL",
        [request.client_id, this.now()],
      );
      const grant = randomUUID();
      const code = token();
      await db.query(
        "INSERT INTO mcp_grants(id, user_id, client_id, resource, scopes, created_at, expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          grant,
          session.user.id,
          request.client_id,
          this.resource,
          scopes,
          this.now(),
          this.now() + GRANT_MS,
        ],
      );
      await db.query(
        "INSERT INTO mcp_codes(token_hash, grant_id, redirect_uri, challenge, expires_at) VALUES($1,$2,$3,$4,$5)",
        [
          hash(code),
          grant,
          request.redirect_uri,
          request.code_challenge,
          this.now() + 5 * MINUTE,
        ],
      );
      redirect.searchParams.set("code", code);
      return redirect.href;
    });
  }

  private async issue(db: PoolClient, grant: Grant, refresh: boolean) {
    const access = token();
    const expires = Math.min(this.now() + ACCESS_MS, Number(grant.expires_at));
    await db.query(
      "INSERT INTO mcp_tokens(token_hash, grant_id, kind, expires_at) VALUES($1,$2,'access',$3)",
      [hash(access), grant.id, expires],
    );
    const refreshToken = refresh ? token() : undefined;
    if (refreshToken) {
      await db.query(
        "INSERT INTO mcp_tokens(token_hash, grant_id, kind, expires_at) VALUES($1,$2,'refresh',$3)",
        [hash(refreshToken), grant.id, grant.expires_at],
      );
    }
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: Math.floor((expires - this.now()) / 1000),
      scope: grant.scopes.join(" "),
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
    };
  }

  async exchange(
    client: RegisteredClient,
    input: {
      grant_type: "authorization_code" | "refresh_token";
      resource: string;
      code?: string;
      redirect_uri?: string;
      code_verifier?: string;
      refresh_token?: string;
      scope?: string;
    },
  ) {
    this.checkResource(input.resource);
    if (!client.grant_types.includes(input.grant_type)) {
      throw new OAuthError(
        "unauthorized_client",
        "This client cannot use that grant type",
      );
    }
    const isCode = input.grant_type === "authorization_code";
    const presented = isCode ? input.code : input.refresh_token;
    if (
      !presented ||
      (isCode &&
        (!input.redirect_uri ||
          !input.code_verifier ||
          !/^[A-Za-z0-9._~-]{43,128}$/.test(input.code_verifier)))
    ) {
      throw new OAuthError(
        "invalid_request",
        "Missing or invalid grant parameters",
      );
    }
    const tokenHash = hash(presented);
    const result = await transaction(this.pool, async (db) => {
      const table = isCode ? "mcp_codes" : "mcp_tokens";
      const found = await db.query(
        `SELECT grant_id FROM ${table} WHERE token_hash = $1${
          isCode ? "" : " AND kind = 'refresh'"
        }`,
        [tokenHash],
      );
      if (!found.rows.length) {
        return null;
      }
      // Serialize exchanges and revocations on the grant before reading token state.
      const grants = await db.query<Grant>(
        "SELECT * FROM mcp_grants WHERE id = $1 FOR UPDATE",
        [found.rows[0].grant_id],
      );
      const grant = grants.rows[0];
      if (
        !grant ||
        grant.client_id !== client.client_id ||
        grant.resource !== this.resource ||
        grant.revoked_at !== null ||
        Number(grant.expires_at) <= this.now()
      ) {
        return null;
      }
      const records = await db.query(
        `SELECT * FROM ${table} WHERE token_hash = $1`,
        [tokenHash],
      );
      const record = records.rows[0];
      if (!record) {
        return null;
      }
      if (
        isCode &&
        (record.redirect_uri !== input.redirect_uri ||
          !equal(
            record.challenge,
            createHash("sha256")
              .update(input.code_verifier!)
              .digest("base64url"),
          ))
      ) {
        return null;
      }
      if (record.used_at !== null) {
        // Commit revocation even though the exchange itself will fail.
        await db.query("UPDATE mcp_grants SET revoked_at = $2 WHERE id = $1", [
          grant.id,
          this.now(),
        ]);
        return null;
      }
      if (Number(record.expires_at) <= this.now()) {
        return null;
      }
      if (input.scope !== undefined) {
        const requested = parseScopes(input.scope);
        if (requested.some((scope) => !grant.scopes.includes(scope))) {
          throw new OAuthError(
            "invalid_scope",
            "Refresh cannot expand the approved permissions",
          );
        }
        grant.scopes = requested;
        await db.query("UPDATE mcp_grants SET scopes = $2 WHERE id = $1", [
          grant.id,
          requested,
        ]);
      }
      await db.query(`UPDATE ${table} SET used_at = $2 WHERE token_hash = $1`, [
        tokenHash,
        this.now(),
      ]);
      return this.issue(
        db,
        grant,
        client.grant_types.includes("refresh_token"),
      );
    });
    if (!result) {
      throw new OAuthError(
        "invalid_grant",
        "The authorization grant is invalid, expired, or already used",
      );
    }
    return result;
  }

  async verify(access: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(access)) {
      return null;
    }
    const result = await this.pool.query<AccessGrant>(
      `SELECT g.*, t.expires_at AS access_expires_at FROM mcp_tokens t JOIN mcp_grants g ON g.id = t.grant_id
      JOIN users u ON u.id = g.user_id
      WHERE t.token_hash = $1 AND t.kind = 'access' AND t.expires_at > $2
      AND g.expires_at > $2 AND g.revoked_at IS NULL AND g.resource = $3
      AND ($4::text[] IS NULL OR u.github_id = ANY($4))`,
      [hash(access), this.now(), this.resource, this.allowedGithubIds],
    );
    return result.rows[0] ?? null;
  }

  async revoke(clientId: string, presented: string) {
    await this.pool.query(
      `UPDATE mcp_grants SET revoked_at = $3 WHERE client_id = $1
      AND id IN (SELECT grant_id FROM mcp_tokens WHERE token_hash = $2)`,
      [clientId, hash(presented), this.now()],
    );
  }

  async connections(userId: string) {
    const result = await this.pool.query<{
      id: string;
      name: string;
      scopes: string[];
    }>(
      `SELECT g.id, c.metadata->>'client_name' AS name, g.scopes FROM mcp_grants g
      JOIN mcp_clients c ON c.id = g.client_id WHERE g.user_id = $1 AND g.revoked_at IS NULL AND g.expires_at > $2 ORDER BY g.created_at DESC`,
      [userId, this.now()],
    );
    return result.rows;
  }

  async disconnect(userId: string, grantId: string) {
    await this.pool.query(
      "UPDATE mcp_grants SET revoked_at = $3 WHERE user_id = $1 AND id = $2",
      [userId, grantId, this.now()],
    );
  }

  async collect() {
    await this.pool.query("DELETE FROM mcp_consents WHERE expires_at <= $1", [
      this.now(),
    ]);
    await this.pool.query("DELETE FROM mcp_grants WHERE expires_at <= $1", [
      this.now(),
    ]);
    // Authorized clients stay after their grants expire so their cached
    // client_id can authorize again.
    await this.pool.query(
      `DELETE FROM mcp_clients WHERE authorized_at IS NULL AND created_at <= $1
      AND NOT EXISTS (SELECT 1 FROM mcp_consents WHERE client_id = mcp_clients.id)`,
      [this.now() - 24 * 60 * MINUTE],
    );
  }
}
