-- VS-542: the MCP tool-list fingerprint an agent session was started under. A runtime session holds
-- the tool definitions it started with, so an upgrade that changes a tool's parameters cannot reach
-- it by resuming; the engine compares this fingerprint before each turn and retires a session whose
-- contract has changed. Nullable: NULL means a row written before this migration, treated as
-- different so it is retired once rather than allowed to hold an unverifiable contract.
ALTER TABLE agent_sessions ADD COLUMN tool_contract TEXT;
