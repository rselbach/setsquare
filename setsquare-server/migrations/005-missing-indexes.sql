CREATE INDEX mcp_consents_session ON mcp_consents(session_hash);
CREATE INDEX mcp_consents_client ON mcp_consents(client_id);
CREATE INDEX mcp_consents_user ON mcp_consents(user_id);
CREATE INDEX mcp_consents_expiration ON mcp_consents(expires_at);
CREATE INDEX mcp_grants_client ON mcp_grants(client_id);
CREATE INDEX mcp_grants_expiration ON mcp_grants(expires_at);
CREATE INDEX mcp_codes_grant ON mcp_codes(grant_id);
CREATE INDEX mutation_receipts_age ON mutation_receipts(owner_id, created_at);
