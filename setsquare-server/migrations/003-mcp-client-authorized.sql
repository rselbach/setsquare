ALTER TABLE mcp_clients ADD COLUMN authorized_at bigint;
UPDATE mcp_clients SET authorized_at = (
  SELECT min(created_at) FROM mcp_grants WHERE client_id = mcp_clients.id
);
