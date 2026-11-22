#!/usr/bin/env bash
#
# VS-995: record what the Antigravity CLI (`agy`) really prints, so the agy runtime adapter's event
# parser is written from real bytes rather than guesses.
#
# Run ONCE, by the machine owner, on the daemon's host, as the daemon's user, while logged in to agy.
# Workers must never run it: it uses the live agy login (see the weave-ai-worker skill).
#
#   scripts/capture-agy-fixtures.sh [OUT_DIR]
#
# OUT_DIR defaults to ~/agy-capture-<UTC stamp>. AGY_BIN overrides the binary (default: `agy` on PATH).
# It spends a few cheap turns on gemini-4-neon-low (AGY_CAPTURE_MODEL overrides) and two read-only
# `/model` slash commands that use no model tokens.
#
# Everything runs against a fresh, absolute `--gemini_dir` under a temp dir, with one throwaway MCP
# server (scripts/agy-capture-echo-mcp.mjs). Your own ~/.gemini is not read or changed. OAuth URLs,
# Google tokens and email addresses are redacted from every file before the script finishes.
#
# What it records (one file per stream, plus `exit` codes):
#   version            agy --version
#   mcp-list           agy --gemini_dir <dir> mcp list (the isolation the adapter relies on)
#   turn1.*            one -p turn: stream-json out, --json-schema, one MCP tool call
#   turn2.*            the same conversation resumed with --conversation <id from turn 1>
#   model-variant.*    -p /model with --model gemini-4-neon-high --effort low (which wins?)
#   model-base.*       -p /model with --model gemini-4-neon --effort high (does a base name resolve?)
#   stdin-prompt.*     the prompt on stdin with a trailing valueless -p (the adapter's long-prompt path)
#   mcp-requests.jsonl every JSON-RPC request agy sent to the MCP server
#   agy-log/           agy's own log files for these runs (model resolution is logged there)
set -u

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
agy="${AGY_BIN:-agy}"
model="${AGY_CAPTURE_MODEL:-gemini-4-neon-low}"
out="${1:-$HOME/agy-capture-$(date -u +%Y%m%dT%H%M%SZ)}"

command -v "$agy" >/dev/null 2>&1 || { echo "agy not found (set AGY_BIN)" >&2; exit 2; }
command -v node >/dev/null 2>&1 || { echo "node not found; the capture MCP server needs it" >&2; exit 2; }
mkdir -p "$out" || exit 2
out="$(cd "$out" && pwd)"

work="$(mktemp -d "${TMPDIR:-/tmp}/agy-capture.XXXXXX")"
gd="$work/gemini"          # absolute --gemini_dir
ws="$work/workspace"       # the turn's working directory
mkdir -p "$gd/config" "$ws"

cat > "$gd/config/mcp_config.json" <<JSON
{ "mcpServers": { "capture": { "command": "node", "args": ["$here/agy-capture-echo-mcp.mjs"], "env": { "CAPTURE_MCP_LOG": "$out/mcp-requests.jsonl" } } } }
JSON

cat > "$work/schema.json" <<'JSON'
{ "type": "object", "properties": { "word": { "type": "string" } }, "required": ["word"], "additionalProperties": false }
JSON

# run NAME ARGS... — stdout, stderr and the exit code of one agy invocation, from the workspace.
run() {
  local name="$1"; shift
  echo "--- $name: $agy $*" >&2
  (cd "$ws" && "$agy" "$@" </dev/null >"$out/$name.stdout" 2>"$out/$name.stderr")
  echo "$?" > "$out/$name.exit"
  echo "    exit $(cat "$out/$name.exit")" >&2
}

"$agy" --version > "$out/version" 2>&1
run mcp-list --gemini_dir "$gd" mcp list

run turn1 --gemini_dir "$gd" -p "Call the echo tool of the capture MCP server with the text weave-capture-7, then answer with the word it returned." \
  --output-format stream-json --json-schema "$work/schema.json" --model "$model" --dangerously-skip-permissions

conv="$(node -e '
  const fs = require("fs");
  let id = "";
  for (const line of fs.readFileSync(process.argv[1], "utf8").split("\n")) {
    try { const e = JSON.parse(line); const c = e?.result?.conversation_id ?? e?.conversation_id; if (typeof c === "string" && c) id = c; } catch {}
  }
  process.stdout.write(id);
' "$out/turn1.stdout")"
echo "$conv" > "$out/turn1.conversation_id"

if [ -n "$conv" ]; then
  run turn2 --gemini_dir "$gd" --conversation "$conv" -p "Which word did you return in your previous answer? Answer with it again." \
    --output-format stream-json --json-schema "$work/schema.json" --model "$model" --dangerously-skip-permissions
else
  echo "no conversation_id in turn1.stdout; turn 2 (resume) skipped" > "$out/turn2.skipped"
fi

# The long-prompt path: prompt on stdin, `-p` last with no value.
echo "--- stdin-prompt" >&2
(cd "$ws" && printf 'Answer with the single word ok.' | "$agy" --gemini_dir "$gd" --output-format stream-json --model "$model" --dangerously-skip-permissions -p \
  >"$out/stdin-prompt.stdout" 2>"$out/stdin-prompt.stderr")
echo "$?" > "$out/stdin-prompt.exit"

run model-variant --gemini_dir "$gd" -p "/model" --model gemini-4-neon-high --effort low
run model-base --gemini_dir "$gd" -p "/model" --model gemini-4-neon --effort high

mkdir -p "$out/agy-log"
cp "$gd"/antigravity-cli/log/*.log "$out/agy-log/" 2>/dev/null || true

# Redact in place: OAuth URLs (PKCE state), Google access/refresh tokens, email addresses.
find "$out" -type f -print0 | xargs -0 sed -i -E \
  -e 's#https://accounts\.google\.com/[^[:space:]"]*#<redacted-oauth-url>#g' \
  -e 's#ya29\.[A-Za-z0-9._-]+#<redacted-token>#g' \
  -e 's#1//[A-Za-z0-9._-]{20,}#<redacted-token>#g' \
  -e 's#[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}#user@example.com#g'

rm -rf "$work"
echo "capture written to: $out" >&2
echo "$out"
