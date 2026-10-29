import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import * as oauth from "oauth4webapi";
import { z } from "zod";

import { transaction } from "./database";

import { ApiError } from "./errors";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";

import type {
  AccountUser,
  SessionInfo,
} from "../../setsquare-app/workspace/api";

import type { ServerConfig } from "./config";

const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const OAUTH_MS = 10 * 60 * 1000;
const profileSchema = z
  .object({
    id: z.number().int().positive().safe().transform(String),
    login: z.string().min(1).max(64),
    name: z.string().max(256).nullable(),
    avatar_url: z.url().max(2048),
  })
  .transform((value) => ({
    githubId: value.id,
    login: value.login,
    name: value.name,
    avatarUrl: value.avatar_url,
  }));
const userSchema = z.object({
  id: z.uuid(),
  login: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.url(),
});

/** The validated GitHub identity used to create or find an account. */
export type GitHubProfile = z.infer<typeof profileSchema>;

/** The external identity-provider operations used by authentication. */
export interface OAuthProvider {
  authorizationUrl(state: string, verifier: string): Promise<URL>;
  authenticate(
    callback: URL,
    state: string,
    verifier: string,
  ): Promise<GitHubProfile>;
}

/** Uses GitHub's authorization code flow with an OAuth protocol client. */
export class GitHubOAuth implements OAuthProvider {
  private readonly server: oauth.AuthorizationServer = {
    issuer: "https://github.com",
    authorization_endpoint: "https://github.com/login/oauth/authorize",
    token_endpoint: "https://github.com/login/oauth/access_token",
  };
  private readonly client: oauth.Client;
  private readonly clientAuth: oauth.ClientAuth;
  private readonly redirectUri: string;

  constructor(
    origin: string,
    credentials: NonNullable<ServerConfig["github"]>,
  ) {
    this.client = { client_id: credentials.clientId };
    this.clientAuth = oauth.ClientSecretPost(credentials.clientSecret);
    this.redirectUri = `${origin}/api/auth/github/callback`;
  }

  async authorizationUrl(state: string, verifier: string) {
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", this.client.client_id);
    url.searchParams.set("redirect_uri", this.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set(
      "code_challenge",
      await oauth.calculatePKCECodeChallenge(verifier),
    );
    return url;
  }

  async authenticate(callback: URL, state: string, verifier: string) {
    const params = oauth.validateAuthResponse(
      this.server,
      this.client,
      callback,
      state,
    );
    const response = await oauth.authorizationCodeGrantRequest(
      this.server,
      this.client,
      this.clientAuth,
      params,
      this.redirectUri,
      verifier,
      { signal: AbortSignal.timeout(15_000) },
    );
    const tokens = await oauth.processAuthorizationCodeResponse(
      this.server,
      this.client,
      response,
    );
    const identity = await oauth.protectedResourceRequest(
      tokens.access_token,
      "GET",
      new URL("https://api.github.com/user"),
      new Headers({
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Setsquare",
      }),
      undefined,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!identity.ok) {
      throw new ApiError(
        502,
        "identity_failed",
        "GitHub could not confirm your identity",
      );
    }
    return profileSchema.parse(await identity.json());
  }
}

/** An authenticated, unexpired Setsquare session. */
export type AuthenticatedSession = {
  tokenHash: string;
  csrfToken: string;
  user: AccountUser;
};

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const token = () => randomBytes(32).toString("base64url");
const equalToken = (a: string, b: string) =>
  timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));

/** Owns session creation and validation independently of HTTP routing. */
export class SessionDatabase {
  constructor(
    private readonly pool: Pool,
    private readonly now: () => number = Date.now,
  ) {}

  async create(profile: GitHubProfile, previousToken?: string) {
    const sessionToken = token();
    const csrfToken = token();
    const user = await transaction(this.pool, async (client) => {
      const result = await client.query(
        `INSERT INTO users(id, github_id, login, name, avatar_url, created_at)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(github_id) DO UPDATE SET login = EXCLUDED.login, name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url
        RETURNING id, login, name, avatar_url AS "avatarUrl"`,
        [
          randomUUID(),
          profile.githubId,
          profile.login,
          profile.name,
          profile.avatarUrl,
          this.now(),
        ],
      );
      const parsed = userSchema.parse(result.rows[0]);
      if (previousToken) {
        await client.query("DELETE FROM sessions WHERE token_hash = $1", [
          hash(previousToken),
        ]);
      }
      await client.query(
        "INSERT INTO sessions(token_hash, user_id, csrf_token, expires_at) VALUES($1,$2,$3,$4)",
        [hash(sessionToken), parsed.id, csrfToken, this.now() + SESSION_MS],
      );
      return parsed;
    });
    return { token: sessionToken, user, csrfToken };
  }

  async find(
    sessionToken: string | undefined,
  ): Promise<AuthenticatedSession | null> {
    if (!sessionToken || !/^[A-Za-z0-9_-]{43}$/.test(sessionToken)) {
      return null;
    }
    const tokenHash = hash(sessionToken);
    const result = await this.pool.query(
      `SELECT s.csrf_token, u.id, u.login, u.name, u.avatar_url AS "avatarUrl"
      FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > $2`,
      [tokenHash, this.now()],
    );
    if (!result.rows.length) {
      return null;
    }
    const row = result.rows[0];
    return {
      tokenHash,
      csrfToken: z.string().parse(row.csrf_token),
      user: userSchema.parse(row),
    };
  }

  async revoke(tokenHash: string) {
    await this.pool.query("DELETE FROM sessions WHERE token_hash = $1", [
      tokenHash,
    ]);
  }
}

/** Enforces session ownership and CSRF before account operations. */
export class Authentication {
  readonly sessions: SessionDatabase;
  readonly cookieName: string;
  private readonly attemptCookie: string;

  constructor(
    private readonly pool: Pool,
    private readonly config: ServerConfig,
    private readonly provider: OAuthProvider | null,
    private readonly now: () => number = Date.now,
  ) {
    this.sessions = new SessionDatabase(pool, now);
    this.cookieName = config.production
      ? "__Host-setsquare-session"
      : "setsquare_session";
    this.attemptCookie = config.production
      ? "__Host-setsquare-oauth"
      : "setsquare_oauth";
  }

  async require(
    request: FastifyRequest,
    options: { pin?: boolean; mutation?: boolean } = {},
  ): Promise<AuthenticatedSession> {
    const session = await this.sessions.find(request.cookies[this.cookieName]);
    if (!session) {
      throw new ApiError(
        401,
        "unauthenticated",
        "Sign in to access your workspace",
      );
    }
    const pin = request.headers["x-setsquare-account"];
    if (options.pin !== false && pin !== session.user.id) {
      throw new ApiError(
        401,
        "account_changed",
        "The signed-in account changed. Sign in again to continue",
      );
    }
    if (options.mutation) {
      const csrf = request.headers["x-csrf-token"];
      if (
        request.headers.origin !== this.config.origin ||
        typeof csrf !== "string" ||
        !equalToken(csrf, session.csrfToken)
      ) {
        throw new ApiError(
          403,
          "csrf_failed",
          "Refresh this page before trying again",
        );
      }
      const source = request.headers["sec-fetch-site"];
      if (source === "cross-site") {
        throw new ApiError(
          403,
          "csrf_failed",
          "Cross-site mutations are not allowed",
        );
      }
    }
    return session;
  }

  private cookie(
    reply: FastifyReply,
    name: string,
    value: string,
    maxAge: number,
  ) {
    reply.setCookie(name, value, {
      path: "/",
      httpOnly: true,
      secure: this.config.production,
      sameSite: "lax",
      maxAge,
    });
  }

  private clearCookie(reply: FastifyReply, name: string) {
    reply.clearCookie(name, {
      path: "/",
      httpOnly: true,
      secure: this.config.production,
      sameSite: "lax",
    });
  }

  register(app: FastifyInstance) {
    app.get("/api/session", async (request): Promise<SessionInfo> => {
      if (!this.provider) {
        return { kind: "local" };
      }
      const session = await this.sessions.find(
        request.cookies[this.cookieName],
      );
      return session
        ? { kind: "signedIn", user: session.user, csrfToken: session.csrfToken }
        : { kind: "signedOut" };
    });
    app.get("/api/auth/github", async (request, reply) => {
      if (!this.provider) {
        throw new ApiError(
          503,
          "auth_unconfigured",
          "GitHub sign-in has not been configured",
        );
      }
      const query = z
        .object({ returnTo: z.string().max(2048).optional() })
        .parse(request.query);
      const destination = new URL(query.returnTo ?? "/", this.config.origin);
      // A redirect to a path starting with "//" would leave this origin.
      const pathname = destination.pathname.replace(/^\/+/, "/");
      if (
        destination.origin !== this.config.origin ||
        pathname.startsWith("/api/")
      ) {
        throw new ApiError(
          400,
          "invalid_return",
          "The return address must be a page in this app",
        );
      }
      const state = oauth.generateRandomState();
      const verifier = oauth.generateRandomCodeVerifier();
      await this.pool.query(
        "INSERT INTO auth_attempts(state_hash, verifier, return_to, expires_at) VALUES($1,$2,$3,$4)",
        [
          hash(state),
          verifier,
          pathname + destination.search + destination.hash,
          this.now() + OAUTH_MS,
        ],
      );
      this.cookie(reply, this.attemptCookie, state, OAUTH_MS / 1000);
      return reply.redirect(
        (await this.provider.authorizationUrl(state, verifier)).href,
      );
    });
    app.get("/api/auth/github/callback", async (request, reply) => {
      if (!this.provider) {
        throw new ApiError(
          503,
          "auth_unconfigured",
          "GitHub sign-in has not been configured",
        );
      }
      const callback = new URL(request.url, this.config.origin);
      const state = callback.searchParams.get("state");
      const cookieState = request.cookies[this.attemptCookie];
      this.clearCookie(reply, this.attemptCookie);
      if (!state || !cookieState || !equalToken(state, cookieState)) {
        throw new ApiError(
          400,
          "invalid_oauth_state",
          "This sign-in request expired. Start sign-in again",
        );
      }
      const result = await this.pool.query(
        "DELETE FROM auth_attempts WHERE state_hash = $1 AND expires_at > $2 RETURNING verifier, return_to",
        [hash(state), this.now()],
      );
      if (!result.rows.length) {
        throw new ApiError(
          400,
          "invalid_oauth_state",
          "This sign-in request expired. Start sign-in again",
        );
      }
      const attempt = z
        .object({ verifier: z.string(), return_to: z.string() })
        .parse(result.rows[0]);
      let profile: GitHubProfile;
      try {
        profile = await this.provider.authenticate(
          callback,
          state,
          attempt.verifier,
        );
      } catch {
        throw new ApiError(
          400,
          "oauth_failed",
          "GitHub sign-in did not finish. Start sign-in again",
        );
      }
      const session = await this.sessions.create(
        profile,
        request.cookies[this.cookieName],
      );
      this.cookie(reply, this.cookieName, session.token, SESSION_MS / 1000);
      return reply.redirect(attempt.return_to);
    });
    app.post("/api/auth/logout", async (request, reply) => {
      const session = await this.require(request, {
        pin: true,
        mutation: true,
      });
      await this.sessions.revoke(session.tokenHash);
      this.clearCookie(reply, this.cookieName);
      return { kind: "signedOut" };
    });
  }
}
