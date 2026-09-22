## Context

See proposal.md — Why. The pieces this builds on:

- An image attachment reaches an agent today only through `weave_inbox`'s MCP `image` content
  (`packages/server/src/tools.ts`, `attachmentsForWake`), established for Claude in ADR 0015 by
  reading the installed CLI's own strings — never by launching it. The turn prompt itself only says
  `_N attachment(s) — read them with weave_inbox._` (`packages/core/src/prompts/index.ts`).
- The built-in `weave` runtime already honours a provider profile's `compat.image.input`
  (`packages/shared/src/config.ts`): `none` drops images, `user` (the default) lifts a tool image into
  a user message, `user_and_tool` embeds it in the tool message (`packages/agent/src/loop.ts`,
  `packages/agent/src/codec/params.ts`).
- Codex and OpenCode receive a prompt string; neither adapter has any image path today
  (`packages/runtimes/*/src/args.ts`, `app-server.ts`, `serve.ts`).
- The run engine is the one place a turn's runtime and model are resolved (`setting`, engine.ts), and
  it already writes the per-run directory (`prompt.md`, `mcp.json`), so it is the natural place to
  materialise a fallback file. The agent's own `read` tool is confined to the worktree and the agent
  home (`packages/agent/src/tools/confine.ts`), so a readable fallback must live in one of those.

### Probe evidence (read-only; no CLI launched)

| Runtime | Where an image input lands | Form declared |
|---|---|---|
| claude | MCP tool-result `image` content becomes a real Anthropic `tool_result` vision block (ADR 0015, from the installed binary's strings). | `native` |
| weave (built-in) | MCP tool images are lifted into a user message or embedded in the tool result unless the profile says `compat.image.input: none` (`loop.ts`/`params.ts`). | `model` |
| codex | The app-server protocol has image input types (`UserInput::LocalImage`/`Image`) and image content items in tool/function-call outputs (`FunctionCallOutputContentItem::InputImage`, `McpToolCallResult`) — but our MCP-tool-result delivery rendering them into the model is not established by our code. | `path` |
| opencode | The binary carries image/`input_image`/`image_url` handling for its own provider layer; our MCP-tool-result delivery is not established. | `path` |
| gemini, cursor | Not probed by this ticket; no image delivery path in our code. | `path` |

The `path` declarations are the honest reading: the ticket accepts a readable path as "a form it can
use", and a path is preferable to an image block a runtime may drop. Upgrading codex/opencode to a
native form via their own turn-input image types is a separate follow-up (Open Questions).

## Goals / Non-Goals

**Goals:**
- Every runtime declares the form in which an image attachment can reach it, with the declaration
  where a reader already looks for runtime capability (`RuntimeCapabilities`).
- A `path`-form run never loses an image attachment: the bytes are on disk, the prompt names the file,
  and the inbox reports the same path.
- Native runtimes are byte-for-byte unchanged: Claude and a vision-capable `weave` model still get the
  MCP `image` block they get today.

**Non-Goals:**
- Wiring codex's or opencode's own native image input (`turn/start` `UserInput::LocalImage`,
  opencode `parts`); the probe is recorded but the native route is not built here.
- A general "read any file for the agent" feature; only the attachments a wake carried, only for a
  `path`-form run.
- Changing attachment storage, caps, the composer or the display on the human's message (VS-657);
  ticket attachments read through `weave_ticket_get` (a separate path) are out of scope.

## Decisions

### Decision 1 — The capability is `imageInput` on `RuntimeCapabilities`

Add an optional `imageInput?: 'native' | 'path' | 'model'` to `RuntimeCapabilities`
(`packages/runtime-sdk/src/index.ts`), defaulting to `'path'` when omitted:

- `native` — an MCP `image` content block reaches the model (claude).
- `model` — native only when the run's resolved provider profile declares image input; the built-in
  runtime, whose profile's `compat.image.input` decides (`none` ⇒ path).
- `path` — the runtime cannot take the block; the daemon gives a readable path.

Optional-with-a-safe-default rather than required, so a plugin-provided runtime that predates this
change keeps the never-silently-drop behaviour instead of failing to register; the six built-in
adapters declare it explicitly.

Alternative considered — a per-adapter `imageInputFor(model)` method: more faithful for the built-in
runtime, but it moves a one-line profile read into every adapter and duplicates the resolution the
engine already has; rejected.

### Decision 2 — The form is resolved once, in the engine, and carried on the run token

A core helper `imageAttachmentForm(ctx, runtimeId, model): 'native' | 'path'` reads the adapter's
declared capability and, for `model`, the resolved provider profile's `compat.image.input`. The engine
computes it once from `setting` and then:

- mints the run token with the form (and the attachment directory, Decision 3);
- builds the prompt with the form's wording;
- so the two read paths (`buildTurnPrompt` and `weave_inbox`) render from the same decided value and
  cannot drift — the VS-638/VS-657 pattern.

`RunTokenClaims` gains optional `imageInput?: 'native' | 'path'` and `attachmentDir?: string`.
`weave_inbox` branches on `ctx.claims.imageInput`; the engine passes the form into
`TurnPromptOptions`.

Alternative considered — letting `weave_inbox` resolve the form itself from `svc(ctx).runs.get(runId)`
and re-read providers: a second resolution that can disagree (the run row's model is written after the
prompt is built); rejected for the same anti-drift reason.

### Decision 3 — A `path`-form run materialises into the agent home, not the worktree

At the prompt-build phase, when the form is `path`, the engine writes each image attachment on the
run's wakes to
`<agent.homePath>/.weave-attachments/<runId>/<attachmentId>-<sanitised filename>` and names the
absolute path in the prompt. Rationale:

- The agent `read` tool's confinement already allows the agent home
  (`confine.ts`: worktree **and** home), so the built-in runtime can read it; the three CLIs read the
  absolute path with their own file tools.
- It is **outside a worker's worktree**, so it can never appear as an untracked file and block
  retirement.
- It is deterministic from `(homePath, runId, attachmentId, filename)`, so `weave_inbox` recomputes the
  same path from the token's `attachmentDir` and the attachment metadata without shared state.

The materialiser writes only image attachments; text documents stay inline in the inbox entry on every
runtime. The current run's directory is pruned of sibling run directories so the home does not grow
without bound. For a ticketless session (whose home is a git repository, VS-526) the home's
`.gitignore` gains `.weave-attachments/` so the daemon's own files never show as repository content.

Alternative considered — the per-run spill directory the file tools already understand: it lives in the
daemon state dir and is refused in `restricted` mode; rejected because the fallback must work in every
permission mode.

### Decision 4 — The prompt names the path; the inbox reports it too

For a `path`-form run, `buildTurnPrompt` replaces the "read them with weave_inbox" line with one that
lists the attachments' readable paths (the same line VS-657 added, made form-aware). `weave_inbox`
returns, in a `path`-form run, the attachment entry with a `path` field and no MCP image block; for a
`native` run it is exactly as today. This keeps the ADR 0015 property that `weave_inbox` is one
installer-neutral read point while satisfying the ticket's "name that path in the turn's prompt".

### Decision 5 — No enforcement in the runtime adapters

Delivery is the daemon's: adapters are not asked to pass an image. The per-adapter work is the
declaration and a test, matching the ticket's "one per runtime adapter for the attachment form it
gets". This keeps the change small and avoids touching the launch path for four CLIs.

## Risks / Trade-offs

- **[A runtime declares `native` but effectively drops the block]** → the declaration is only as good
  as its evidence; claude is pinned by ADR 0015, and the other runtimes ship as `path` (the
  never-drop form). The PR records the probe evidence per runtime.
- **[The fallback writes into a session home the human may inspect]** → the directory is hidden,
  gitignored in the session repo, pruned per run, and capped by the existing attachment caps
  (4 files/message; 5 MB image) so its footprint is bounded.
- **[A worker reads a path named in its prompt with a relative path]** → the prompt always names the
  absolute path, and the path is inside the agent home which the file tools allow.
- **[The run token grows]** → two small optional fields; the token already carries the run's agent
  kind, ticket, plan and role.
- **[`weave_ticket_get` still returns ticket-attachment image blocks unconditionally]** → out of
  scope, and named in Open Questions rather than silently changed.

## Open Questions

- **Should codex and opencode get a native form?** Their protocols carry image input types
  (`UserInput::LocalImage` / `Image`, opencode `parts`), so a later change could feed the image
  through the adapter's own turn input instead of a path. Deferred: it needs per-adapter changes and
  cannot be verified without the real CLI, and the path form already satisfies "never silently
  dropped".
- **Should `weave_ticket_get`'s ticket-attachment image blocks follow the same form?** A ticket read
  returns an `image` block on every runtime today; if a `path`-form runtime drops it, that read is
  affected too. Out of the composer/thread scope this ticket names; recorded here as a follow-up.

## Migration Plan

No schema, config or API migration. Deploy is the normal daemon upgrade; rollback is reverting the
commit. Existing attachments, runs and sessions are unaffected; a `native` runtime's delivery is
unchanged, and a `path` runtime gains a file it did not have before.