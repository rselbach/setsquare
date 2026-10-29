CREATE TABLE users (
  id uuid PRIMARY KEY,
  github_id text NOT NULL UNIQUE,
  login text NOT NULL,
  name text,
  avatar_url text NOT NULL,
  created_at bigint NOT NULL
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token text NOT NULL,
  expires_at bigint NOT NULL
);
CREATE INDEX sessions_expiration ON sessions(expires_at);

CREATE TABLE auth_attempts (
  state_hash text PRIMARY KEY,
  verifier text NOT NULL,
  return_to text NOT NULL,
  expires_at bigint NOT NULL
);

CREATE TABLE folders (
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id text NOT NULL,
  parent_id text,
  name text NOT NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  trashed_at bigint,
  PRIMARY KEY(owner_id, id),
  FOREIGN KEY(owner_id, parent_id) REFERENCES folders(owner_id, id)
    ON DELETE CASCADE,
  CHECK(parent_id IS DISTINCT FROM id)
);

CREATE TABLE drawings (
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id text NOT NULL,
  folder_id text,
  name text,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  opened_at bigint,
  trashed_at bigint,
  revision bigint NOT NULL CHECK(revision > 0),
  content_version integer NOT NULL DEFAULT 1 CHECK(content_version = 1),
  content jsonb NOT NULL,
  thumbnail jsonb,
  PRIMARY KEY(owner_id, id),
  FOREIGN KEY(owner_id, folder_id) REFERENCES folders(owner_id, id)
    ON DELETE CASCADE
);
CREATE INDEX drawings_folder ON drawings(owner_id, folder_id);
CREATE INDEX folders_parent ON folders(owner_id, parent_id);

CREATE TABLE assets (
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id text NOT NULL,
  mime_type text NOT NULL,
  bytes bytea NOT NULL CHECK(octet_length(bytes) <= 5242880),
  created_at bigint NOT NULL,
  uploaded_at bigint NOT NULL,
  last_retrieved bigint NOT NULL,
  version integer NOT NULL CHECK(version > 0),
  PRIMARY KEY(owner_id, file_id)
);

CREATE TABLE drawing_assets (
  owner_id uuid NOT NULL,
  drawing_id text NOT NULL,
  file_id text NOT NULL,
  PRIMARY KEY(owner_id, drawing_id, file_id),
  FOREIGN KEY(owner_id, drawing_id) REFERENCES drawings(owner_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY(owner_id, file_id) REFERENCES assets(owner_id, file_id)
    ON DELETE RESTRICT
);
CREATE INDEX drawing_assets_file ON drawing_assets(owner_id, file_id);

CREATE TABLE mutation_receipts (
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id text NOT NULL,
  payload_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at bigint NOT NULL,
  PRIMARY KEY(owner_id, request_id)
);
