## Context

See `proposal.md`. The current chat frame in `packages/ui/src/routes/Chat.tsx` is a vertical stack:

```
<Page>                                            // flex h-full min-h-0 flex-col
  <PageHeader … actions={<ContextMeter/><SessionLimit/>} />
  {onboarding bar}
  <div className="relative flex min-h-0 flex-1 flex-col">   // transcript wrapper
    <PageBody scrollRef={attachScroll}>…</PageBody>
    <ScrollToBottomButton/>
  </div>
  <section aria-label="Open decisions" …>          // pinned strip (Chat.tsx:804)
  <div>…<Composer/></div>
</Page>
```

Constraints that shape the approach:

- **The height chain.** `Page` is `flex h-full min-h-0 flex-col`; the transcript wrapper is
  `flex min-h-0 flex-1 flex-col`; `PageBody` is `ac-scroll min-h-0 flex-1`. A horizontal frame that
  wraps the transcript, the (optional) pinned strip and the composer, with the rail as its sibling,
  needs `min-h-0`/`min-w-0` at every flex level or the panes grow to content and neither scrolls.
  `KnowledgeExplorer.tsx` is the house two-pane pattern: `h-full min-h-0` root, `min-w-0 min-h-0
  ac-scroll` panes, and a CSS variable for the pane width.
- **The pinned area's machinery is bottom-specific.** `lib/decisionHeight.ts` models a pixel height
  dragged by the region's *top* edge between a composer below it and the list above it
  (`HeightBounds { sectionBottom, pageTop }`); the separator at `Chat.tsx:824` is
  `aria-orientation="horizontal"`. It has no meaning for a full-height column.
- **The hidden-from-chat affordance lives inside the pinned region** (`Chat.tsx:843-851`) and is part
  of the same `shown` / `hiddenOpen` pair that decides whether the region renders at all.
- **Answered decisions are deliberately inline** in the transcript (`Chat.tsx:737-756`); that
  invariant is stated in the code comment and is unchanged.
- **`ChatPage` is rendered by `ChatRoute` and by the global Chats panes** (`ChatPage` with
  `focused`). The layout choice belongs to the page, so it applies wherever `ChatPage` renders; no
  separate global-chat variant is introduced.
- **The diff toggle is the precedent.** `PullRequestDiff.tsx:56-65` renders two `Button`s
  (`Unified` / `Side-by-side`, `secondary` for the active one) and hides the whole control on a phone
  via a local `useMediaQuery('(max-width: 767px)')`.

## Goals / Non-Goals

**Goals:**
- A device-local `bottom` / `split` choice for where open decisions render, defaulting to today's
  behavior and surviving a reload.
- A discoverable control on the chat screen, consistent with the diff toggle.
- A right-hand rail in `split`, with the conversation and composer keeping the left pane.
- Independent scrolling in both panes; no dead rail when nothing is open.
- `bottom` below the `md` breakpoint regardless of storage; the control does not offer `split` there.
- Answered decisions, hidden-from-chat count, attachments and dictation all unchanged in behavior.

**Non-Goals:**
- The workspace-wide Needs you page (`GlobalNeeds.tsx`) — out of scope per the ticket, and VS-287 owns
  it.
- Any change to a decision card's contents or when its approve action appears.
- Making the choice a workspace or account setting, or syncing it across devices.
- A draggable rail divider (the house pattern uses a CSS variable; a fixed, bounded width is enough
  for this change and avoids expanding the contract).

## Decisions

### Persistence: a new `lib/decisionLayout.ts` mirroring `lib/diffLayout.ts`

A single `useDecisionLayout(): [DecisionLayout, (l) => void]` with:

- `export type DecisionLayout = 'bottom' | 'split'`
- `const KEY = 'conductor.decisions.layout'` — beside `decisionHeight.ts`'s
  `conductor.decisions.height`, and consistent with `chatPrefs.ts`'s `conductor.chat.*`.
- Default written as the *absence* of the key: `readDecisionLayout()` returns `'bottom'` unless the
  stored value is `'split'`; `setLayout('bottom')` removes the key. Storage refusal is caught and the
  choice holds for the session.

**Why no event, unlike `lib/chatPrefs.ts`:** `chatPrefs` publishes a `window` event because the switch
lives on Settings and the reader on Chat, two components never mounted together. Here the control and
the rail both live inside `ChatPage`, so one `useState` in one hook call drives both; there is no
second reader to notify. If implementation shows a second consumer (e.g. a future global-chat switch),
that is a scope change to surface, not a silent addition.

### Control: two small Buttons in the header actions, hidden below `md`

`PageHeader` already carries screen-level controls in `actions` (`ContextMeter`, `SessionLimit`), so a
two-option segmented control (`Bottom` / `Side`, `secondary` for the active option) goes there, styled
after `PullRequestDiff.tsx`'s two `Button`s. The header is the stable, always-visible place: the
pinned strip can be empty, so a control inside it would disappear exactly when the human wants to
switch back.

The control is wrapped in `hidden md:flex` (matching the header meta's `hidden md:inline`), so a
narrow viewport is not offered an option it cannot honour. This mirrors `PullRequestDiff`, which hides
its toggle outright on a phone.

**Alternative considered:** an icon-only `IconButton` to save header width. Rejected — the ticket
says to stay consistent with the diff toggle, which is label-driven, and a word is more discoverable
than a glyph with no established icon for "decisions on the right".

### Narrow viewport: the `md` breakpoint, forced in JS

A local `useMediaQuery('(max-width: 767px)')` in `Chat.tsx` (the same local-hook shape used by
`KnowledgeExplorer.tsx`, `PullRequestDiff.tsx`, `Live.tsx` and others; jsdom's `matchMedia` default is
`false`, and tests override it). `effective = narrow ? 'bottom' : stored`.

**Why JS rather than CSS-only `hidden md:flex`:** a CSS-only rule would mount both the bottom strip
and the rail and hide one, putting duplicate decision cards (and duplicate answer handlers) in the
DOM. JS keeps exactly one region mounted, which is both correct and testable in jsdom.

**Breakpoint choice:** the ticket names `md` explicitly. At `md` the split is genuinely tight, so the
rail width is bounded (below) and the trade-off is reported rather than hidden.

### Frame: horizontal flex, CSS variable for the rail width, fixed not draggable

Restructure the frame so the transcript, the bottom strip (when applicable) and the composer share a
left column, with the rail as a sibling:

```
<Page>
  <PageHeader … actions={<LayoutToggle/> <ContextMeter/> <SessionLimit/>} />
  {onboarding}
  <div className="flex min-h-0 flex-1" style={{ '--rail-w': … }}>
    <div className="flex min-w-0 min-h-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1 flex-col">…transcript…</div>
      {effective === 'bottom' && hasDecisions ? <BottomStrip/> : null}
      <div className="flex-none …"><Composer/></div>
    </div>
    {effective === 'split' && hasDecisions ? <Rail/> : null}
  </div>
</Page>
```

The rail is `min-w-0 min-h-0 ac-scroll w-[var(--rail-w)] flex-none`; the left column is
`min-w-0 min-h-0 flex-1`. The `min-h-0`/`min-w-0` on every flex level is what makes each pane scroll
rather than push, exactly as `KnowledgeExplorer.tsx` documents.

The width is a CSS variable on the frame, defaulting to `min(30rem, 34%)` — a cap rather than a fixed
pixel so the conversation keeps roughly two thirds on a small laptop while the rail never grows
absurdly wide on a large display. Because it is a variable, a future draggable divider is additive;
this change does not add one.

**Alternative considered:** `md:w-80 lg:w-96` fixed classes. Rejected — the house pattern is a CSS
variable for pane width, and the variable expresses the "fraction with a cap" intent in one place.

### Empty rail: collapse, do not hold a quiet line

The rail renders only when `shown.length || hiddenOpen.length` — the same predicate the bottom strip
already uses. With nothing open and nothing hidden, `split` renders no rail and the conversation
takes the full width. A quiet "nothing needs you" line would still be a permanent column taking a
share of the screen for a status the header already states ("N need you"); collapsing matches the
bottom layout's own behavior, where the strip is simply absent when empty, and satisfies "no dead
column" literally.

### `decisionHeight` stays bottom-only; the rail is full-height

The drag height is a top-edge resize of a bottom strip measured against the composer below it. It is
not reused for a column. In `split` the separator is not rendered, `decisionHeight` is ignored, and
the rail is bounded by the frame and scrolls within itself. The `readBounds` / `dragBounds` machinery
is untouched for `bottom`; the handle simply is not in the tree in `split`, so no drag can start.

### One region, one `aria-label`

The rail keeps `aria-label="Open decisions"` (the same label the bottom strip uses), so assistive
tech and the existing tests address "where the open decisions are" without caring which layout is
active. The hidden-count button and the `DecisionCard`s render from the same `shown` / `hiddenOpen`
data in both regions; the only difference is the container and its classes.

## Risks / Trade-offs

- [At `md`–`lg` widths, `split` narrows the conversation below today's `max-w-3xl`] → inherent to a
  side rail; the rail is capped at 34% (`min(30rem, 34%)`) and the human opts in. Reported with
  screenshots at both widths rather than hidden; captain can reject if it reads badly.
- [Independent scrolling silently fails because a `min-h-0`/`min-w-0` is missed in the chain] → every
  flex level in the new frame carries both, and a component test asserts the rail and the transcript
  are siblings each with their own scroll container.
- [Duplicate decision cards in the DOM via CSS-only layout switching] → the layout is decided in JS,
  so only one region is mounted. A test asserts the strip is absent when the rail is present.
- [The header gets crowded with meters plus the toggle] → the toggle is two compact `Button`s placed
  with the other header controls, hidden below `md`; the header already wraps (`flex-wrap`).
- [Existing `chat.test.tsx` asserts `getByLabelText('Open decisions')` and the resize separator in the
  default/bottom state] → the default stays `bottom`, so those tests remain valid; the separator is
  asserted absent under `split`, and new tests cover the rail. Test updates are for the new behavior,
  not deletion of existing coverage.
- [The local `useMediaQuery` is the Nth copy in the repo] → pre-existing duplication; this change adds
  one more matching the established pattern rather than refactoring seven other files.

## Migration Plan

Pure UI change: no data migration, no route registration, no feature flag. Rollback is a revert of the
UI files. The only persisted artifact is the `conductor.decisions.layout` key, which an older build
simply ignores.

## Open Questions

- Whether the rail width should become draggable (as in `KnowledgeExplorer`). The variable makes this
  additive later; the ticket asks only for the toggle between two layouts.
