## Context

`packages/ui/src/routes/TicketPage.tsx` renders the V1 ticket page. Its tab bar has seven entries
(`overview`, `plan`, `activity`, `work`, `artifacts`, `usage`, `knowledge`), Artifacts filtered out
when the ticket has none, and each tab renders its own component. `Overview`, `ActivityTab`,
`WorkTab` and `UsageTab`/`KnowledgeUsageTab` each fetch their own data through TanStack hooks and
each wrap themselves in `mx-auto max-w-3xl`.

Captain wants the same page to read as one view (2026-09-13): details beside live activity, then
work, usage and knowledge, with Plan as the only other tab. VS-346 is doing the equivalent for the
V2 page at `/v2`; this change is V1 only and must not touch `packages/ui/src/v2/**`.

Goals: one Overview tab carrying all four rows in order; a two-pane row 1 that scrolls its activity
pane independently and stacks on narrow widths; old `?tab=` links still landing; the same actions;
no extra live streams. Non-goals: any change to Plan or Artifacts content, any daemon/API change, and
any V2 change.

## Decisions

### 1. Compose the existing tab components as sections; do not rewrite them

`Overview`, `ActivityTab`, `WorkTab`, `UsageTab` and `KnowledgeUsageTab` already do exactly the work
the rows need. They become section components (`OverviewSection`, `ActivitySection`, `WorkSection`,
`UsageSection`, `KnowledgeSection`) and each keeps its data, hooks, decisions and composer. Only
their outer wrapper changes: the `mx-auto max-w-3xl` moves to the parent, so a section can sit in a
half-width pane or a full-width row without centring itself twice. Rejected: a rewrite, which would
re-derive behaviour that is already specified and tested (VS-106, VS-110, VS-201, VS-250).

### 2. The tab set is Overview, Plan and conditional Artifacts; Overview is the default

`TABS` loses `activity`, `work`, `usage` and `knowledge`. Artifacts stays in the list but is filtered
out of the bar unless the ticket has an artifact, exactly as today. `resolveTab` keeps Overview as the
default. V1 today does **not** open a ticket on Artifacts when one exists — `resolveTab` returns
Overview for every unnamed or unknown value and Artifacts is only reached when named — and that
default-tab rule is preserved. Only a named `?tab=artifacts` opens it.

### 3. Legacy tab values are aliases for Overview plus a section scroll

`?tab=` still accepts `overview`, `plan` and `artifacts`. The removed values are not errors: a
resolver maps `activity`, `work`, `usage` and `knowledge` to the Overview tab, and records which
section the value named. An effect on `OverviewTab`'s mount scrolls `#ticket-section-<name>` into
view (the target is the first matching `section`/`div` id) so a link that meant "the conversation" or
"the usage" lands on it rather than at the top. An unknown value falls back to Overview with no
scroll. `scrollIntoView` is called defensively (`?.`) because jsdom does not implement it.

Keeping the alias rather than rewriting the two links that use it means a bookmarked or in-flight
`?tab=activity` URL keeps working *and* still reaches the pane it meant, which a plain `?tab=overview`
would not on a narrow screen where the panes stack. No new `section=` parameter is introduced; the
ticket named only the three accepted tab values and the old-value mapping.

### 4. Every UI link that opened a ticket on an old tab was audited

A repository-wide search for ticket links carrying a tab found exactly three: two pull-request "view"
links in `project/PullRequestsSection.tsx` and the merge card's "Ask the worker" link in
`components/DecisionCard.tsx`, all `tab: 'activity'`. The Examples the ticket guessed at — Needs you,
Live, notifications — open a ticket with no tab at all and therefore already land on Overview. The
three `tab=activity` links are left as they are on purpose: they resolve through the alias to the
activity pane, which is the behaviour they were written for (VS-106). `project/KnowledgeSection` and
`lib/map/model.ts` pass `tab: 'knowledge'` but to the **`/w/$ws/knowledge` route**, not to a ticket,
and are untouched.

### 5. Row 1 is a responsive grid; the activity pane scrolls itself

`OverviewTab` wraps the page in `mx-auto max-w-5xl` (wide enough for two panes; Artifacts already
uses `max-w-5xl`) with `flex flex-col gap-6`. Row 1 is `grid gap-5 lg:grid-cols-2 items-start`, DOM
order overview then activity, so it stacks overview-first below `lg`. The activity pane adds
`lg:max-h-[70vh] lg:overflow-y-auto`, giving it its own scroll region on wide screens so a long feed
cannot push Work, Usage and Knowledge out of reach; below `lg` no height cap is applied and the page
scrolls as one column. The Activity composer stays at the end of that pane, as it is today at the end
of the Activity tab.

### 6. Section order is explicit and addressable

Rows carry stable ids — `ticket-section-overview`, `ticket-section-activity`,
`ticket-section-work`, `ticket-section-usage`, `ticket-section-knowledge` — in that DOM order. Rows 2
to 4 get a short heading (`Work`, `Usage`, `Knowledge`) so the merged page reads as sections rather
than as one undifferentiated column; the inner labels (`Work products`, `Runs`, …) are unchanged.
The ids are also the scroll anchors for decision 3 and the hook for the order test.

### 7. No extra live streams, no refetch loop

The Overview tab mounts `ActivitySection` once, so each running run opens exactly one `useRunEventStream`
(one `RunTurn` instance), the same count as the old Activity tab. `RunTurn` still opens a stream and
fetches a transcript only while expanded, and a finished turn is still collapsed until clicked. All
rows call the same `useTicket(ticketId)` query key, which TanStack dedupes, so rendering every row at
once adds no repeated fetch. Rejected: lazy-mounting the lower rows — the ticket asks for one page
with the rows visible, and the queries already exist.

### 8. Tests follow the tabs they replaced

`ticketpage.test.tsx` and `liveTranscript.test.tsx` click "Activity" and "Knowledge" tabs that no
longer exist. They are rewritten to render the default Overview (where the feed and sections now are)
and to assert the tab set, the section order, the old-value mapping and the composer send. Nothing
about the assertions' intent changes; only where the content lives.

## Risks

- A nested scroll region (activity pane inside the page's own scroller) can trap a wheel gesture. The
  pane is capped and `overscroll-behavior: contain` is not applied to it, so the page can still be
  scrolled from beside it; if it feels trapped in review, the cap can be raised without a spec change.
- `scrollIntoView` is absent under jsdom; the effect guards the call, and the mapping tests assert the
  selected tab and section presence rather than movement.
- The unused `TAB_KEYS` list must lose the removed keys, or `resolveTab` would keep selecting a tab
  with no component; the resolver is rewritten rather than trimmed so that cannot happen.
