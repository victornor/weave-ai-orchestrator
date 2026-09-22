## Why

A persistent session's conversation cannot be steered while it works: a message sent during a running turn is queued behind that turn and only read once it finishes, so the human's new instruction arrives stale and the running work cannot be stopped. Separately, a message that was entered by voice dictation reaches the agent as ordinary text, so the agent cannot know that small misspellings, mangled command names and wrong homophones are likely.

## What Changes

- A message sent to a **ticketless persistent session that has a running turn** interrupts that turn now — the CLI's Escape-equivalent: stop the model and any tool call in progress — and starts a new turn on the **same session** with the message, so the agent keeps its context. It is never silently queued.
- The behaviour is required on every runtime a session can use (claude, codex, opencode, weave); a runtime that cannot be interrupted cleanly is named and what it does instead is shown to the human.
- Rapid messages sent while the turn is stopping coalesce into the **one** resumed turn, in order, and every message is delivered exactly once.
- An interrupted turn's transcript stays in the conversation, marked interrupted, and the tool calls that were cut off are marked not completed.
- The session composer states before sending that a send will interrupt the running turn.
- A message entered with the composer's voice dictation is delivered to the agent with a leading `(voice dictated)` line, at the prompt and in `weave_inbox`; the **stored** message text is unchanged and a typed message is never marked.
- A small per-user (device-local) setting "mark all my messages as voice dictated", off by default, marks every message for a human who dictates everything.
- A persistent session's **composer gains attachments**: the human can paste an image, press the attach control, or drop files, under the same accepted types, per-message limit and rejection feedback as the conductor chat. The files ride in the same request as the text, are stored under the existing attachment caps, are shown on the human's message in the session conversation, and reach the session agent through the same inbox mechanism the weaver chat uses. This reuses the conductor chat's thread-attachment pipeline; no new storage or serving path.
- **Split to a second ticket** (stated in full below): the per-runtime *form* of an attachment — which runtimes and models see an image natively, and what a runtime that cannot take one gets instead (for example a readable file path). This is generic runtime work, not session-specific, and is not built here.
- **Not changed:** ticketed workers keep the existing VS-254 mid-turn/interrupt behaviour, and the weaver's chat still queues while a turn runs (listed in design.md as a separate open question).

### Split: the per-runtime form of an attachment (second ticket)

Today a human-message attachment is delivered runtime-neutrally: the agent's inbox tool returns an image's bytes as image content and a text document's literal content, and the turn prompt points the agent at its inbox. Whether a given runtime's CLI and model actually *see* that image is not established by this repository's code — Claude renders MCP image content; the built-in runtime passes an image to the model only when its provider profile declares image input; Codex and OpenCode behaviour needs a probe. The proposed second ticket:

- declares a runtime capability for native image input, probed per runtime (claude, codex, opencode, weave-built-in);
- for a runtime or model that cannot take an image, writes the attachment to a readable location (the agent's home or worktree) and names that path in the prompt/inbox so the agent can still read it;
- adds the per-runtime tests and the test for "a runtime that cannot take images" the third ask names.

The composer, storage, display and their tests (paste, button, several files, over-cap) stay in this change, with the light/dark captures of an attachment on a session message.

## Capabilities

### New Capabilities

- `run-transcripts/interrupted-turn`: how an interrupted turn's transcript is marked — the turn itself and the in-flight tool calls that were cut off — on every transcript surface, generically.
- `voice-dictated-messages`: carrying a message's voice-dictated provenance from the composer to the delivered agent prompt without changing the stored message, and the "mark all my messages as voice dictated" setting.

### Modified Capabilities

- `persistent-sessions`: a message to a running session interrupts and resumes on the same session (coalescing, exactly-once, runtime coverage, the composer's pre-send statement), and a session's composer accepts attachments under the conductor chat's rules and shows them on the human's message.

## Impact

- **core**: `threads/service.ts` (inbound path — interrupt a session's running turn, resume wake), `runs/active.ts` (`describeLiveInput` for a session), `prompts/index.ts` (the interrupted note and the dictated marker), `workers/index.ts` (session send path), `tickets/service.ts` and `decisions/service.ts` (dictated flag on comment/answer payloads).
- **runtime-sdk / runtimes**: no new mechanism — reuse `runs.cancel(…, 'interrupt', 'message')`; add a per-adapter interrupt test (fake process) for claude, codex, opencode, weave, and state the signal-only runtimes.
- **render**: transcript builder marks trailing pending tool calls `interrupted` when the run ended interrupted/cancelled.
- **server**: `routes/threads.ts`, `routes/workers.ts`, `routes/decisions.ts` accept the `dictated` flag; `tools.ts` `weave_inbox` renders the marker.
- **ui**: V2 `ChatComposer`/`DictationSession` and V1 `Composer`/decision cards send the dictated flag; the V1 `Composer` gains `allowAttachments` for the session page and `WorkerPage` sends the files through the existing multipart path; `SessionThreadFeed` renders the message's `AttachmentRows`; settings gain the marking toggle; the session turn surface shows the interrupted marker.
- No database migration: the dictated flag rides in the wake/answer payload, the interrupted marker is derived from `runs.status`, and attachments reuse the existing `attachments` table and serving route.
