import path from "node:path";

import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  APP_ORIGIN: z.url().default("http://localhost:3001"),
  DATABASE_URL: z.string().min(1),
  GITHUB_CLIENT_ID: z.string().min(1).optional(),
  GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3002),
  HOST: z.string().default("127.0.0.1"),
  SETSQUARE_STATIC_DIR: z.string().optional(),
  MCP_ALLOWED_ORIGINS: z.string().optional(),
  ALLOWED_GITHUB_IDS: z.string().optional(),
  ALLOW_ANY_GITHUB_ACCOUNT: z.enum(["true", "false"]).optional(),
  TRUST_PROXY: z.string().optional(),
});

/** The server's validated deployment settings. */
export type ServerConfig = {
  production: boolean;
  origin: string;
  databaseUrl: string;
  host: string;
  port: number;
  staticDir: string;
  github: { clientId: string; clientSecret: string } | null;
  /** GitHub user ids that may sign in, or null to admit any GitHub account. */
  allowedGithubIds: string[] | null;
  mcpAllowedOrigins?: string[];
  /**
   * Proxies whose X-Forwarded-For entries are believed: false for none, a hop
   * count, or the proxies' addresses and CIDR ranges.
   */
  trustProxy: false | number | string[];
};

// `true` would believe the leftmost X-Forwarded-For entry, which the client controls
const parseTrustProxy = (value: string | undefined) => {
  if (!value) {
    return false;
  }
  if (/^[0-9]+$/.test(value)) {
    const hops = Number(value);
    if (!Number.isSafeInteger(hops) || hops < 1) {
      throw new Error("TRUST_PROXY must be a positive hop count");
    }
    return hops;
  }
  const address = z.union([z.ipv4(), z.ipv6(), z.cidrv4(), z.cidrv6()]);
  return value.split(",").map((entry) => {
    const parsed = address.safeParse(entry.trim());
    if (!parsed.success) {
      throw new Error(
        "TRUST_PROXY must be a hop count or proxy IP addresses and CIDR ranges",
      );
    }
    return parsed.data;
  });
};

/** Parses environment configuration before starting the server. */
export const loadConfig = (env: NodeJS.ProcessEnv): ServerConfig => {
  const parsed = envSchema.parse({
    ...env,
    GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID || undefined,
    GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET || undefined,
    MCP_ALLOWED_ORIGINS: env.MCP_ALLOWED_ORIGINS || undefined,
    ALLOWED_GITHUB_IDS: env.ALLOWED_GITHUB_IDS || undefined,
    ALLOW_ANY_GITHUB_ACCOUNT: env.ALLOW_ANY_GITHUB_ACCOUNT || undefined,
    TRUST_PROXY: env.TRUST_PROXY?.trim() || undefined,
  });
  const origin = new URL(parsed.APP_ORIGIN);
  if (!["http:", "https:"].includes(origin.protocol)) {
    throw new Error("APP_ORIGIN must use HTTP or HTTPS");
  }
  if (
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password
  ) {
    throw new Error("APP_ORIGIN must contain only the origin");
  }
  const production = parsed.NODE_ENV === "production";
  if (production && (origin.protocol !== "https:" || !env.APP_ORIGIN)) {
    throw new Error("Production requires an explicit HTTPS APP_ORIGIN");
  }
  const { GITHUB_CLIENT_ID: clientId, GITHUB_CLIENT_SECRET: clientSecret } =
    parsed;
  if (!!clientId !== !!clientSecret) {
    throw new Error(
      "GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set together",
    );
  }
  if (production && (!clientId || !clientSecret)) {
    throw new Error("Production requires GitHub OAuth credentials");
  }
  const allowedGithubIds =
    parsed.ALLOWED_GITHUB_IDS?.split(",").map((value) => {
      const id = value.trim();
      // GitHub ids never change hands, unlike logins
      if (!/^[1-9][0-9]*$/.test(id)) {
        throw new Error(
          "ALLOWED_GITHUB_IDS must contain numeric GitHub user ids",
        );
      }
      return id;
    }) ?? null;
  const allowAny = parsed.ALLOW_ANY_GITHUB_ACCOUNT === "true";
  if (allowedGithubIds && allowAny) {
    throw new Error(
      "Set ALLOWED_GITHUB_IDS or ALLOW_ANY_GITHUB_ACCOUNT=true, not both",
    );
  }
  if (production && !allowedGithubIds && !allowAny) {
    throw new Error(
      "Production requires ALLOWED_GITHUB_IDS or ALLOW_ANY_GITHUB_ACCOUNT=true",
    );
  }
  return {
    production,
    origin: origin.origin,
    databaseUrl: parsed.DATABASE_URL,
    host: parsed.HOST,
    port: parsed.PORT,
    staticDir: path.resolve(
      parsed.SETSQUARE_STATIC_DIR ?? "../setsquare-app/build",
    ),
    github: clientId && clientSecret ? { clientId, clientSecret } : null,
    allowedGithubIds,
    mcpAllowedOrigins: parsed.MCP_ALLOWED_ORIGINS?.split(",")
      .map((value) => z.url().parse(value.trim()))
      .map((value) => {
        const allowed = new URL(value);
        if (
          allowed.origin !== value ||
          !["http:", "https:"].includes(allowed.protocol)
        ) {
          throw new Error(
            "MCP_ALLOWED_ORIGINS must contain exact HTTP(S) origins",
          );
        }
        return allowed.origin;
      }),
    trustProxy: parseTrustProxy(parsed.TRUST_PROXY),
  };
};
