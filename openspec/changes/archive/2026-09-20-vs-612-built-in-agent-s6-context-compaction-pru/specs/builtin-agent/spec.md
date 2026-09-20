## ADDED Requirements

### Requirement: Sessions are trees with compaction records
The session file SHALL keep one entry per message with `id` and `parentId`, and SHALL support a `compaction` entry carrying a summary, `firstKeptEntryId`, token counts before and after, and accumulated read and modified file lists. The history sent to the model SHALL be the summary as a first user message followed by the messages from `firstKeptEntryId` to the leaf. Files written before this change SHALL load unchanged, and a torn last line SHALL be dropped.

#### Scenario: A compacted session resumes
- **WHEN** a session containing a compaction entry is resumed and the next request is built
- **THEN** the first non-system message of the request body is the summary and the messages before `firstKeptEntryId` are absent

#### Scenario: Old linear file
- **WHEN** a session file with only message entries is loaded
- **THEN** its history is every message in order

### Requirement: Compaction never splits a tool call from its results
The compactor SHALL choose the start of the kept span on a turn boundary, a `user` or `assistant` message and never a tool result, so that every kept tool result has its tool call in the kept span and every summarised tool call has its results summarised with it. The kept span SHALL always include the newest user message.

#### Scenario: Random histories
- **WHEN** compaction cut points are computed over many random histories of user, assistant tool-call and tool-result messages
- **THEN** no kept tool result lacks its tool call, and the newest user message is always kept

### Requirement: Compaction triggers proactively and reactively
Before each request the agent SHALL compact when the estimated request size exceeds the context window minus `max(16384, maxOutputTokens)`. On a `context_overflow` response it SHALL compact once and retry the step; a second overflow in the same turn SHALL fail the turn. When the window is unknown the agent SHALL not compact proactively and SHALL log one warning. A failed summary SHALL leave the session unchanged. Compaction SHALL emit `session.compaction.started` and `session.compaction.completed` events.

#### Scenario: Proactive
- **WHEN** the estimate crosses the threshold before a request
- **THEN** a summary request is made, a compaction entry is appended, and the following request starts with the summary

#### Scenario: Reactive
- **WHEN** the provider answers a 400 context overflow
- **THEN** the agent compacts and retries once, and a second overflow fails the turn with `context_overflow`

#### Scenario: Unknown window
- **WHEN** no context window is known
- **THEN** no proactive compaction happens and one warning is logged

### Requirement: The summary is structured and iterative
The summary request SHALL use the same model and profile without tools, SHALL pass the previous summary when one exists, SHALL cut tool results in the summarised span to 2000 characters, and SHALL ask for Goal, Constraints, Progress, Decisions, Files, Next steps and Critical context. Read and modified file lists SHALL be accumulated by code across compactions.

#### Scenario: Second compaction
- **WHEN** a session that already has a compaction is compacted again
- **THEN** the summary request contains the previous summary and the file lists include files from both spans

### Requirement: Old tool output is pruned only in the projection
Above 70 % of the window the agent SHALL replace tool results older than the newest 40k tokens of tool output with a stub naming the original size, provided this saves at least 20k tokens. Below 70 % nothing SHALL be pruned. The session file SHALL never be modified by pruning.

#### Scenario: Below threshold
- **WHEN** the estimate is under 70 % of the window
- **THEN** the request body contains every tool result unchanged

#### Scenario: Above threshold
- **WHEN** the estimate is over 70 % and old tool results total more than 20k tokens
- **THEN** those results appear as stubs in the request and in full in the session file

### Requirement: Token counting prefers the provider's numbers and counts tool schemas
The agent SHALL estimate with js-tiktoken and a safety margin, SHALL use the provider's `prompt_tokens` plus an estimate of later messages once a response exists, and SHALL include the serialised tool schemas in every estimate.

#### Scenario: Weaver-sized tool set
- **WHEN** about 40 tool schemas are supplied and no response has been received
- **THEN** the estimate includes their tokens

### Requirement: Instructions and skills load lazily
The first successful `read`, `edit` or `write` in a directory SHALL append the nearest not-yet-loaded `AGENTS.md` files up to the worktree root to the tool result, once each, capped at 32 KiB. Skills in `<home>/.agents/skills` SHALL be listed by name and description in the system prompt and their bodies returned by a `skill` tool.

#### Scenario: Nested AGENTS.md once
- **WHEN** two files in the same subdirectory are read
- **THEN** the first result carries that directory's `AGENTS.md` and the second does not

#### Scenario: Skill tool
- **WHEN** the model calls `skill` with an indexed name
- **THEN** the result is the skill body and its directory

### Requirement: The system prompt is small and byte-stable
The fixed preamble SHALL be at most 1200 tokens excluding the AGENTS text and the skill index, and the system message SHALL be byte-identical across the requests of a session.

#### Scenario: Two requests
- **WHEN** two consecutive requests are recorded
- **THEN** their system messages are equal

### Requirement: Prompt caching follows the profile
A profile flag `promptCache` SHALL select `none`, `key` (send `prompt_cache_key` equal to the session id) or `anthropic` (send `cache_control` markers on the system message, last tool and last user block). Nothing SHALL be sent when the flag is `none` or unset. Cached prompt tokens SHALL be read from `cachedTokensField` and reported in `TurnResult.usage.firstRequest`.

#### Scenario: Key mode
- **WHEN** `promptCache` is `key`
- **THEN** every request body carries `prompt_cache_key` equal to the session id

#### Scenario: Cached usage
- **WHEN** the first response reports cached tokens
- **THEN** `usage.firstRequest.cachedTokens` equals that number

### Requirement: The adapter compacts, forks, describes and expires sessions
The adapter SHALL implement `compactSession` by running the child in compact mode, `forkSession` by copying the session file under a new id, and `describeSession` by reading the file. It SHALL declare `forkSessions` and `contextCompactionAt`. Session files not used for 30 days, configurable through `sessionRetentionDays`, SHALL be deleted at child start, never the current session.

#### Scenario: Fork
- **WHEN** a session is forked
- **THEN** the new ref points at a new file whose entries equal the original's

#### Scenario: Retention
- **WHEN** a session file is 31 days old and another is 2 days old
- **THEN** only the older one is removed at the next child start

### Requirement: Long sessions hold at the weaver's scale
A history of 500 or more messages with about 40 `weave_*` tool schemas SHALL compact, resume and continue without losing the last human message, and a weaver-kind turn that calls `weave_human_send` SHALL complete through the loopback MCP.

#### Scenario: 500-message weaver history
- **WHEN** a 500-message session with the weaver tool set exceeds the trigger
- **THEN** it compacts, the next request starts with the summary and includes the newest user message, and the turn continues

#### Scenario: Human send
- **WHEN** the model calls `weave_human_send`
- **THEN** the tool call reaches the mock MCP server and its result is fed back to the model
