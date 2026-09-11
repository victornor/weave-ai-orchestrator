# Catalogue captures (2026-09-11)

Read-only dumps taken before any parser was written (conductor review of VS-228).

| File | argv | version | exit | notes |
|---|---|---|---|---|
| `opencode-models-verbose.stdout.txt` | `opencode models --verbose` | 1.18.30 | 0 | Pretty-printed: `provider/model` line, then a JSON object with `variants`. Empty `variants: {}` on some rows. No `disabled` variants in this dump. |
| `codex-debug-models-bundled.stdout.txt` | `codex debug models --bundled` | codex-cli 0.153.4 | 0 | Gitignored: ~518 KiB, embeds `base_instructions` / `model_messages`. Wire shape is `models[].slug` + `models[].supported_reasoning_levels[].effort` — **not** `supportedReasoningEfforts`. |
| `codex-models-stripped.json` | derived from that stdout | same | — | Same field names and effort values; prompt blobs removed. |

A command that failed would have been recorded in `*.meta.txt` and that runtime would omit `efforts`.
