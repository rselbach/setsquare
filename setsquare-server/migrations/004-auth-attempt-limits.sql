ALTER TABLE auth_attempts ADD COLUMN source_hash text;
CREATE INDEX auth_attempts_expiration ON auth_attempts(expires_at);
CREATE INDEX auth_attempts_source ON auth_attempts(source_hash, expires_at);
