## 1. Stop discarding content before storage

- [x] 1.1 In `packages/runtime-sdk/src/process.ts`'s `classifyError`, replace
      `(stderr.trim().split('\n').pop() || \`exit ${exitCode}\`).slice(0, 500)` with
      `truncate(stderr.trim().split('\n').pop() || \`exit ${exitCode}\`, 4000)` (import `truncate`
      from `./fsutil.js`, already exported). Verify with a unit test in `packages/runtime-sdk`'s
      existing process/adapter tests: feed a synthetic stderr whose last line is a realistic long
      error (a "Cannot use this model: X. Available models: …" list with 50+ comma-separated
      entries, well under 4000 chars) and assert the returned `message` contains the list's last
      entry verbatim, and a second case whose last line exceeds 4000 chars asserts the returned
      message ends with `truncate`'s `…[+N chars]` marker.
- [x] 1.2 In `packages/core/src/runs/engine.ts`, import `truncate` from `@agent-conductor/runtime-sdk`
      (already a dependency) and replace the catch-block's `err.message.slice(0, 500)` (~line 375)
      with `truncate(err.message, 4000)`.
- [x] 1.3 In `packages/core/src/runs/engine.ts`'s `parkForHuman` (~line 633), replace both
      `message.slice(0, 400)` call sites — `pauseDetailJson.message` (~line 654) and the decision's
      `context` line `` `Last error: ${message.slice(0, 400)}` `` (~line 680) — with
      `truncate(message, 4000)`, applied once to a local `const boundedMessage = message ?
      truncate(message, 4000) : null` and reused in both places, so the two stay in sync by
      construction rather than by two separate call sites agreeing on a number.
- [x] 1.4 In `packages/core/src/runs/engine.test.ts`, extend the existing `retry_approval` coverage
      (~line 958, the test asserting `context` `.toContain('the CLI died')`) with a case using a
      realistic long message including a trailing comma-separated list: assert the decision's
      `context` and the paused agent's `pauseDetailJson.message` both contain the list's last entry,
      not only its start. Add a second case with a message over 4000 chars asserting both end with
      the `truncate()` marker.

## 2. Decision card shows the full text, bounded for layout

- [x] 2.1 In `packages/ui/src/components/DecisionCard.tsx`, give the `decision.context` block
      (~line 255) a collapse/expand: when the markdown source is longer than a threshold (match the
      length check style already used by `GlobalIncidents.tsx`'s `IncidentRow`), render a bounded
      preview plus a visible "Show full text" button (`aria-expanded`, same convention as
      `ProjectSection`/`Transcript`); clicking it renders the complete `decision.context` via the
      same `Markdown` component. A context under the threshold renders inline exactly as it does
      today, with no control.
- [x] 2.2 In `packages/ui/src/test/*` (add to or create a `DecisionCard.test.tsx` alongside the
      existing decision-card tests), add a case with a realistically long `context` (the model-list
      example, several thousand characters, ending in a distinctive final entry): assert the control
      is present, the final entry is NOT in the DOM before clicking, and IS in the DOM after
      clicking — not merely that a button exists. Add a second case with a short context asserting
      no control renders and the text is present inline immediately.

## 3. The ticket page reaches the same full-text view

- [x] 3.1 In `packages/ui/src/routes/TicketPage.tsx`, alongside the existing `planDecision`/
      `mergeDecision` lookups, add a lookup for an open `retry_approval` decision on the ticket
      (`decisions.data?.find((d) => d.kind === 'retry_approval' && (d.ticketId === ticketId ||
      d.ticketId === ticketIdentifier))`) and render it with the same `DecisionCard` used for plan
      and merge approvals, in the page body. The existing `pausedFor` header chip (~line 132) is
      unchanged by this task.

      Correction while implementing: the Plan/merge "approvals" on this page turned out to be a
      bespoke banner (`PlanTab`/`ActivityTab`), not the shared `DecisionCard` component — only
      Chat/NeedsYou/GlobalNeeds used it. Rendering a second bespoke banner here would have meant
      re-inventing the expand-in-place behavior just added to `DecisionCard`, so this task instead
      imports and renders the real `DecisionCard` on the Overview tab (the default tab) when an open
      `retry_approval` decision exists for the ticket — the same reachable card as every other
      surface, not a third pattern.
- [x] 3.2 Add a test (`packages/ui/src/test/TicketPage.test.tsx` or wherever existing ticket-page
      tests live) asserting that a ticket with an open `retry_approval` decision shows the decision
      card's full context on the page, using the same long-message fixture as 2.2's last entry to
      confirm it is reachable from here too.

## 4. Compact previews carry the full message, not just a shorter copy of themselves

- [x] 4.1 In `packages/render/src/entities.ts`, add `workerPauseDetail(agent): { summary: string;
      full: string } | null` alongside the existing `workerPauseReason` (which keeps its current
      signature and behavior unchanged — every existing caller, TUI and CLI included, is
      unaffected). `full` joins the same parts as the summary but without `oneLine`'s cap, so it
      carries the complete `family`/`message`/`resetAt` line.
- [x] 4.2 In `packages/ui/src/components/WorkerCard.tsx` and `TicketCard.tsx`, use
      `workerPauseDetail` where a `title` tooltip is set on the paused-for text (`WorkerCard.tsx`
      ~line 85), passing `full` to `title` instead of the same capped `pausedFor` string.

      `TicketCard.tsx` doesn't call `workerPauseDetail` itself — it only receives a plain
      `workerPausedFor` string prop from `Board.tsx`, its one caller. Added a parallel
      `workerPausedForFull` prop (falls back to `workerPausedFor` when absent) and updated
      `Board.tsx`'s one `pausedFor()` helper to call `workerPauseDetail` and pass both.
- [x] 4.3 In `packages/ui/src/routes/TicketPage.tsx`, do the same for the header chip's `title`
      (~line 132).
- [x] 4.4 Add or extend a test per touched component asserting the visible text stays the capped
      one-line summary (with its ellipsis) while the `title` attribute carries the longer message —
      using a pause detail long enough that the two differ.

## 5. TUI stays honest without a pager

- [x] 5.1 In `packages/render/src/decision.ts`'s `decisionToCard` (~line 217), raise the
      `oneLine(ctx, 600)` cap to `1200` — modest headroom now that core can hand it up to 4000
      chars, without attempting a full pager. `oneLine`'s existing ellipsis remains the visible
      marker; no other change needed here.
- [x] 5.2 In `packages/render/src/decision.test.ts`, add a case with a context longer than 1200
      chars asserting the card's context line ends with `oneLine`'s `…` and is capped at 1200, and a
      case at or under 1200 chars asserting it renders in full with no `…`.

      Correction while implementing: a context short enough to equal its own 140-char rationale
      preview is deduped out of the body entirely (existing behavior, predates this change) — it
      shows once, as `card.rationale`, not twice. The "at or under the cap" case asserts that instead
      of a body line.

## 6. Spec and delivery

- [x] 6.1 Confirm `openspec validate vs-201-failure-messages-truncate-with-no-way-to --json --strict`
      passes.
- [x] 6.2 Run `pnpm lint && pnpm typecheck && pnpm test` and confirm all are green.

      One `pnpm test` run showed one failure in
      `packages/core/src/runs/engine.test.ts`'s "...third consecutive authentication failure..." — a
      known, already-documented ULID/timestamp-tie flake on a full run (project KB), unrelated to
      this change. A second full run was clean: 2019 core tests + 1286 UI tests, all green, lint and
      typecheck clean.
- [x] 6.3 Open the PR, record it on the ticket, and state plainly that the truncation was happening
      before storage (not at render), which is why a UI-only fix would not have worked, and that
      Telegram needed no change because it already chunks instead of truncating.

      PR: https://github.com/victornor/agent-conductor/pull/163
