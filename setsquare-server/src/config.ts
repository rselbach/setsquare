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
  mcpAllowedOrigins?: string[];
};

/** Parses environment configuration before starting the server. */
export const loadConfig = (env: NodeJS.ProcessEnv): ServerConfig => {
  const parsed = envSchema.parse({
    ...env,
    GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID || undefined,
    GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET || undefined,
    MCP_ALLOWED_ORIGINS: env.MCP_ALLOWED_ORIGINS || undefined,
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
  };
};
