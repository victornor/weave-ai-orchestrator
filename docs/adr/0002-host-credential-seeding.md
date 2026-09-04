# ADR 0002 — Seed per-workspace runtime config homes from the host user's CLI credentials

Date: 2026-09-04 · Status: accepted

## Context
Each workspace gives every coding CLI its own config home (`<workspace>/.agent-conductor/runtimes/<runtime>/`, exported as `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, …) so agent runs never mutate the operator's personal CLI configuration and session stores stay per workspace. A fresh home has no credentials, so the first conductor turn failed with "Not logged in".

## Decision
On workspace load the daemon copies the host user's credential files (only credentials, never settings) into a runtime home that has none: `~/.claude/.credentials.json`, `~/.codex/auth.json`, `~/.gemini/{oauth_creds,google_accounts}.json`, `~/.local/share/opencode/auth.json`, mode 0600. `conductor runtime login <id>` can replace them later; nothing is copied when the workspace home already has credentials.

## Consequences
Local use "just works" when the operator is logged in to the CLIs; on a server the operator logs in once on the daemon host. Credentials never leave the daemon host and are never written to logs or the database.
