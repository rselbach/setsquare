CREATE TABLE mcp_clients (
  id text PRIMARY KEY,
  metadata jsonb NOT NULL,
  secret_hash text,
  registration_ip_hash text NOT NULL,
  created_at bigint NOT NULL
);
CREATE INDEX mcp_clients_registration ON mcp_clients(registration_ip_hash, created_at);

CREATE TABLE mcp_consents (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_hash text NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
  client_id text NOT NULL REFERENCES mcp_clients(id) ON DELETE CASCADE,
  request jsonb NOT NULL,
  expires_at bigint NOT NULL
);

CREATE TABLE mcp_grants (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id text NOT NULL REFERENCES mcp_clients(id) ON DELETE CASCADE,
  resource text NOT NULL,
  scopes text[] NOT NULL,
  created_at bigint NOT NULL,
  expires_at bigint NOT NULL,
  revoked_at bigint
);
CREATE INDEX mcp_grants_owner ON mcp_grants(user_id);

CREATE TABLE mcp_codes (
  token_hash text PRIMARY KEY,
  grant_id uuid NOT NULL REFERENCES mcp_grants(id) ON DELETE CASCADE,
  redirect_uri text NOT NULL,
  challenge text NOT NULL,
  expires_at bigint NOT NULL,
  used_at bigint
);

CREATE TABLE mcp_tokens (
  token_hash text PRIMARY KEY,
  grant_id uuid NOT NULL REFERENCES mcp_grants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('access', 'refresh')),
  expires_at bigint NOT NULL,
  used_at bigint
);
CREATE INDEX mcp_tokens_grant ON mcp_tokens(grant_id);
