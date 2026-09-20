-- VS-621: the workspace MCP servers a role's built-in-agent (`weave` runtime) runs may use.
-- A JSON array of server names, defaulting to none: a run gets only the servers it is allowed.
ALTER TABLE roles ADD COLUMN mcp_servers_json TEXT NOT NULL DEFAULT '[]';
