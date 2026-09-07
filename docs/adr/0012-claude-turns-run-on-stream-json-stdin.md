# ADR 0012 — Claude turns run on stream-json stdin, always

**Status:** accepted · 2026-09-07 · deviates from PLAN §8's headless-turn row for the Claude adapter,
and from §14b.1's description of the attach input line as queued-only

## Context

VS-99 ("a human can attach to a running agent, watch it live and type into it") needed to settle a
genuine unknown first: whether a coding CLI can accept input for a turn that is already executing,
and how. Launching the real CLI to find out is forbidden by the runtime-credential rule (a live
invocation can rotate the daemon's OAuth refresh token out from under every agent in the workspace).
The answer was established instead by reading the installed `claude` binary's own strings — its help
text, its validation errors, and a `--messaging-socket-path` log line that shows the exact frame
shape — never by executing it. The evidence is recorded in full in
`openspec/changes/vs-99-a-human-can-attach-to-a-running-agent-se/design.md`.

That evidence: `--input-format stream-json` is realtime streaming input, it requires `--print` and
`--output-format stream-json`, and the CLI states plainly that "stream-json input requires a readable
stdin for the lifetime of the session." A `user` frame is
`{"type":"user","message":{"role":"user","content":"..."}}`, and `--replay-user-messages` echoes each
consumed frame back on stdout as an acknowledgement.

Before this change, `buildArgs` ran every turn with `--input-format text`, the prompt as an argv
operand (or, past `MAX_ARGV_PROMPT`, as plain stdin text), and `spawnLines` ended the child's stdin
immediately after writing it. There was no channel to attach to, at any point in a turn's life.

## Decision

The Claude adapter now runs every turn as `-p --output-format stream-json --verbose --input-format
stream-json --replay-user-messages`, with the prompt sent as the turn's first `user` frame on stdin
rather than as an argv operand or plain text. `spawnLines` gained a `stdinMode: 'open'` that leaves
the child's stdin writable instead of ending it, and a `write()`/`endStdin()` pair on the object it
returns. `TurnHandle` gained an optional `send(text): Promise<InputDelivery>` that a runtime omits
entirely when it cannot deliver input mid-turn.

Because the CLI keeps the session alive for as long as stdin is readable, **the adapter closes stdin
itself the instant it sees the turn's `result` line** — otherwise every turn would run to its
timeout regardless of whether the model was still working. That is also the precise boundary "mid-turn"
has: `send()` can deliver from spawn until the `result` line, and reports `closed` after it, so a
caller never has to guess whether it is still in the window.

The channel is unconditional, not opt-in per attach. It cannot be opened after a process has already
started, so there is no way to spawn "normally" and add a channel only once a human shows up; the
choice is between always-on and never. A `defaults.liveInput` boolean (default `true`) is the escape
hatch, returning the whole adapter to the pre-VS-99 spawn — argv/stdin-text prompt, `--input-format
text`, no `send()` — for an operator who needs to rule this out entirely.

`workers.message()` tries `send()` only when asked for `live` delivery and a run with a channel is
executing; anything else — the runtime declares no `streamingInput`, no turn is running, or the
write itself reports `closed` — falls back to exactly the wake-queuing behavior that existed before
this change. Codex, Gemini and OpenCode are untouched: they declare `streamingInput: false` and never
carry a `send()`, per PLAN §8's own record that each would need an unrelated warm-process protocol
(`codex app-server`, `opencode serve`, nothing for Gemini).

## Why

- **The transport had to be settled with evidence, not left as an open question**, per the ticket's
  own instruction. The binary's strings are load-bearing documentation here precisely because running
  it is not an option under the credential rule.
- **Stdin cannot be reopened mid-process.** A human attaching partway through a turn can only ever
  reach a channel that was already open, so "open it lazily when someone attaches" is not an
  available design — the channel has to be a property of how the turn was spawned.
- **Closing on `result` rather than on the adapter's own timeout keeps the turn's shape unchanged**:
  spawn, stream, exit, exactly as the engine already expects. The alternative — leaving stdin open
  until the process exits on its own — doesn't exist, because the process does not exit while stdin
  is open; something has to close it, and the only correct moment is when the turn's own answer has
  already arrived.
- **A capability that isn't reported honestly is worse than one that doesn't exist.** `describeLiveInput`
  and the worker detail's `input.reason` exist so the composer never offers what it cannot do.

## Consequences

- Every Claude turn's argv and stdin usage changed, not only attended ones — verified by
  `packages/runtimes/claude/test/args.test.ts` asserting the whole head and the exact frame for both
  the live and the `liveInput: false` shapes, and by a fake-CLI adapter test
  (`packages/runtimes/claude/test/liveInput.test.ts`) exercising the real spawn path end to end.
  Nothing here has been verified against the real CLI; that remains the owner's to confirm on the
  first live deploy.
- A turn that never emits a `result` line (a genuine hang) would hold stdin open until the existing
  turn timeout and kill-group escalation end it — unchanged from before, since those mechanisms never
  depended on stdin's state.
- `--replay-user-messages` echoes the adapter's own frames back on stdout; `events.ts` treats any
  `user` frame carrying string content as an echo rather than a fresh input or a tool result (tool
  results always carry array content), so it produces no event.
- Rollback is `defaults.liveInput: false` in `workspace.yaml`, which restores the pre-VS-99 spawn
  exactly; nothing persisted by this change needs unwinding.
