# Weave — UI change list

Companion to the `Weave.dc.html` / `Screens.dc.html` mockup. Every item below is a
change requested during the design session, in the order a implementer would most
usefully take them. Where a change replaced an earlier decision, only the final
state is described.

---

## 1. Naming and identity

- **Conductor → weaver** everywhere. One weaver per workspace; the human talks only
  to it. Chat identity, rail label, settings copy, run agent names (`Weaver · acme`,
  `Weaver · fernwood`), decision-card headers ("Held by the weaver", "Weaver looked",
  "Weaver reviewed — concerns"), and the CLI hint (`weave login`).
- **Product name on screen is `WeaveAI`** — one word, no space, capital W and capital
  AI. Used in the expanded sidebar header.
- The chat screen is called **Chat**, not "Weaver chat".
- **No avatar or profile picture for the weaver** anywhere in chat. It is not a person
  with a face; messages are identified by position and metadata only.

## 2. Theme and colour

- **Mono is the only palette.** The multi-palette picker used during exploration was
  removed; it was a design tool, not a feature. Mono's hexes are the app's single hue
  set, declared once with separate dark and light values.
- Greyscale chrome, with hue kept **only where work is live** — `working` amber,
  `needs-you` indigo, `blocked` red. `done`, `merging` and `idle` stay greyscale.
- **Dark theme is near-black**: ground `#050506`, cards `#0b0b0d`, raised `#101012`,
  hairlines pulled down to match.
- **Project colour is an identity, not a state**, and appears wherever a project is
  named — ticket cards (top right), board rows, table rows, chat message metadata,
  decision-card meta lines, Live card ticket lines, Knowledge rows, Scheduled scopes,
  Settings project lists, and the rail. Same hue in every location.
- **Project names in the rail are coloured text** — no coloured dot or square beside
  them.
- **In-app light/dark switch** in the sidebar footer (crescent / disc), beside the
  account line. Collapsed rail gets a single toggle button. The switch above the
  frame in the mockup is harness scaffolding and should not ship.
- Prose links are **underlined** (1px, 2px offset). Mono deliberately has no link
  hue, so the affordance has to be non-chromatic. Links take `--accent-link`, never a
  hardcoded hex.
- Contrast: text inks were tuned per theme to clear 4.5:1 against their own grounds.
  `--text-4` collapses into `--text-3` in both themes — there is no room for four
  distinguishable inks that all clear the bar. Never dim a container with `opacity`;
  it composites faint inks below the threshold. Use a recessed background and a
  stronger ink instead.

## 3. Shape and density

- **Corners are angular**: 4–6px on cards and controls, 2–4px on tags. No pill shapes
  anywhere.
- **Tags are bordered with slightly rounded corners** — 1px border tinted from the
  tag's own colour, 4px radius, mono 10px. One recipe for kind, tier, state, project,
  model, and the inline ticket reference. Not borderless, not pills.
- **Sidebar is 194px** (from 232px). **Header bars are 38px** (from 46px) — both the
  generic screen header and Chat's own status bar, so they match.
- Content should get as much width as possible; the rail's internal padding and nav
  row rhythm were tightened accordingly.
- Chat and decision cards are **not full width** — decision cards in chat sit at
  roughly the same width as on Needs you, not stretched to the pane.

## 4. Navigation

- **Structure**: a global "Everywhere" group above the workspaces, matching the
  existing app. Everywhere holds Needs you, Live, Incidents, Map, Runs, Scheduled,
  Settings. A workspace holds Chat, Needs you, Work, Roles, Knowledge.
- **Live is global only.** The workspace Live entry was removed; scope is a filter on
  the global screen (`Everywhere · Acme · Fernwood`).
- **Settings is global**, with two levels of tabs (see §9).
- **Knowledge stays workspace-scoped.**
- **Board is renamed Work** — operational tickets have no PR and no column that fits
  a change flow.
- **No hotkey numbers** in the rail — not on workspace sections, not on projects.
- **No "Projects" section heading** — the coloured project names distinguish
  themselves.
- **No `⌘K` hint.** Its slot holds the **sidebar collapse button**.
- **Collapsed rail (48px)**: the Weave mark alone (no wordmark; clicking expands),
  then every destination as its mark only, grouped exactly as when expanded — global
  marks, a hairline rule, a small mono workspace initial (`A`), then that workspace's
  marks. Needs you keeps a dot when it has open decisions. Labels on hover.
- **Icons on every rail row**, expanded and collapsed.
- **The workspace Needs you is a shortcut**, not a separate screen: it opens the same
  global screen with its scope filter pre-applied. Exactly one rail row highlights at
  a time.
- **Phone tab bar**: Chat · Needs you · Work · Live · More. Needs you and Live open
  the **global** views; Work stays workspace-scoped (a board of one workspace's
  tickets is what the screen is).
- **More is a destination list**, not an alias for one screen: grouped Everywhere /
  Acme / mockup pages, 48px rows with marks, counts and chevrons. Every screen has a
  phone route.

## 5. Chat

- **Desktop chat is split by default** — conversation left, decisions right. Docking
  was removed. The divider is draggable (300–560px). Below ~620px of pane width the
  decisions pane drops out and chat goes full width.
- **Phone chat has no decisions container.** Decisions are answered on Needs you.
- **Chat carries its own status bar** (workers running, need-you count, session
  usage). The generic breadcrumb header is suppressed there — two stacked top bars
  cost stream height for nothing.
- **Working traces.** Between tool calls the weaver narrates in italic, at a dimmer
  ink than a finished message, so work-in-progress is visually distinct from
  something addressed to the human. Tool rows carry the tool name and its argument;
  result lines are indented two spaces under the call that produced them.
- Messages carry **timestamps and token counts**, plus a Reply affordance and a
  collapsed summary line (`▸ weaver did 7 tool calls · 34s · 18.4k tok · 419k/1M ctx`).
- **Inline reference tags** — ticket ids render as clickable bordered mono tags inside
  running prose, distinct from plain code spans for literals like `main` or a file
  path. Prose links to pages read as underlined text.
- **Attachments** appear as rows beneath a message body: artifacts, files and
  knowledge pages, each with its glyph, byline and kind label.
- **Composer**: three identical buttons — paperclip (attach), microphone (dictate),
  send (solid triangle) — on the raised surface with a hairline border and 6px
  corners. The scope selector above it picks a **project** (`Auto · web · api ·
  infra`), coloured per project; it is not a workspace selector.

## 6. Decisions (Needs you and the chat pane)

- **Needs you carries the full decision card**, not a summary that punts to chat. The
  card is the primary surface; chat mirrors it.
- **No status glyphs on decision card headers.** "Needs you" and "Worker question"
  are neutral text, not coloured.
- **Held state.** A card the weaver has concerns about shows: the objection in the
  weaver's own words, a `Revision in progress · Nm` row with a pulsing dot and a
  **Watch** toggle, Approve disabled, `Override…` beside it, and "Approval is blocked
  until a revision lands."
- **Watch expands the live worker feed in place** — the same feed the Live screen
  shows, in a compact variant, with its own toggle state per card.
- **Override** opens a required reason field, states that the reason is recorded on
  the ticket and tells the weaver to stand down, and offers "Override and approve".
- The three review states are `unseen` / `looked` / `concerns`. This is a property of
  the **decision**, not the ticket — it appears on cards only and never as a board
  column.
- **Artifacts are reachable from Needs you** when a ticket has one.
- The chat pane's held card carries the same anatomy, sized for the narrow pane,
  plus a work-product link and "Ask the worker".
- Scope filters lead the filter row (`Everywhere · Acme`), then decision kinds.

## 7. Work

- **Columns**: Backlog · Proposed · In progress · In review · Blocked · Done.
- **Two views**: kanban board and table, switchable.
- **Empty columns are narrower** (~108px) and expand when they hold cards. They are
  otherwise styled identically to the others — no tint, no "Empty" label.
- **No status glyph on cards** — the column already states the status. Glyphs remain
  on the phone list and table rows, which are not grouped by column.
- **No status glyph on column headers** — name and count only.
- **Project tag top-right of every card**, in the project's hue.
- **Worker role on its own bottom row**, under a hairline, with the age beside it, so
  long role names ("Platform Engineer #206") are not truncated. Tags wrap on their
  own line above.

## 8. Live

- **Two cards per row** by default on desktop, with a **−/+ control** (1–4 per row).
  Feed height scales inversely: 420 / 300 / 240 / 200px. Phone is always one column.
- **Cross-workspace.** Scope chips (`Everywhere · Acme · Fernwood`) filter for real;
  the header states the roster and what is shown (`6 running · showing 2`).
- **Card header shows the resolved model**, not the option name — "Sonnet (latest)",
  not "standard". The option name moved to the ticket line below.
- **No worker status glyph in the header**; the status word carries the state hue.
- Feeds hold real scrollback (16–19 trace lines), preserve authored indentation, and
  hang wrapped continuations past the marker column.

## 9. Settings

- **Global, with two tab levels.** A scope row (`This daemon · Acme · Fernwood ·
  Sideprojects`) and a section row that changes with it, plus a line stating what the
  current scope applies to.
- **Daemon** sections: Updates · Models · Security & devices.
  - Updates follows the existing key-value table idiom: version, commit, release
    path, release source, update tag, Check again / Upgrade, and the last upgrade's
    log in a scrolling block.
- **Workspace** sections: Weaver · Models · Projects · Knowledge · Budget. No section
  is a dead tab.
- **The daemon has no "applies to" control.** It *is* the default for every
  workspace. One line states the relationship; a workspace that sets its own models
  overrides it.
- **Models, redesigned.** Same things exposed, three structural changes:
  - Runtime / model / thinking sit in **one row per agent**, not a column of
    identical full-width selects. Weaver and Workers are two cards, each with a note
    saying what the agent is.
  - **Worker options are collapsed rows** (id, model tag, one-line summary); expand
    one to edit. The permanently-visible empty "new option" form is replaced by
    `+ Add option`.
  - **"When to use" is a real multiline field** with the character count out of the
    way, and a line stating why it matters: the weaver reads this and nothing else.
- **Workspace overrides.** Agents *and* worker options can each be overridden per
  workspace, with an `inherited` / `overridden` tag, Override / Reset to daemon, an
  accent border when overridden, recessed controls when inherited, and a footer
  naming **the actual diff** ("Overrides thinking high → max"). The banner counts
  what is overridden. The option *list* stays the daemon's — a workspace changes
  which model an option runs on, not what the option means, since the description is
  what the weaver reads.

## 10. Roles (was Team)

- Renamed **Roles**. Roles are hired per project; workers are spawned per ticket from
  them.
- Grouped by project, each role showing its state, worker count, charter, and its
  running workers.
- **Clicking a working worker expands its live feed in place** — the same feed as the
  Live screen, with model, ticket title, trace, spend and an "Open in Live" link.
  Workers with no live session keep their old behaviour.
- **Hire a role opens a modal**: project picker, a free-text field for what the role
  should own, and a preview of **the message the weaver receives** (`/hire-role
  project=infra` plus the description) — the form's whole job is formatting a request
  the weaver can recognise, so that should be visible. Footer notes the charter comes
  back for approval.

## 11. Incidents

- **One flat list**, not a dashboard: `All · Open · Resolved` chips, then cards with a
  status dot (pulsing while open), title, and a meta line of state · time · scope.
  Expand for what failed in a sentence, the relevant log lines, and the error code.
- **No Retry or Resolve-by-hand actions.** Incidents are the weaver's to handle; the
  open card says so and says it will ask in chat if it needs a decision. This is a
  record you read, not a console you operate.

## 12. Runs (new, global)

- Dense table: status (with glyph) · agent · model · turn ended · tokens · cost ·
  duration · when, with a state filter row (`all · queued · running · succeeded ·
  failed · timed_out · cancelled · interrupted`).
- **Agent and model get the width**; numeric columns shrink first.
- Cross-workspace — the agent column names both weavers and workers from every
  workspace.
- Phone collapses each run to a card.
- Rows open a **Run detail** view: state and turn outcome, a metadata table (agent,
  model, started, duration, tokens with context, cost, trigger), the full tool trace,
  and a plain-language account of how the turn ended.

## 13. Map (new, global)

- A **graph**, not a table: workspace → project → worker nodes with "runs in" edges.
- Filters (`Everywhere · Acme · Fernwood · Attention`) prune the graph, and the
  legend derives from the statuses actually present.
- **Nodes are clickable**, routed by kind — a worker opens Live, a project opens
  Work, a workspace opens its chat.
- Footer states what is shown, distinctly phrased from the header's roster total.

## 14. Artifacts

- An agent can publish a self-contained HTML document to a ticket.
- **Rendered inline on the ticket**, above the fold, on its own tab — not behind a
  link. Also browsable in Knowledge.
- A **full-screen reader** with its ticket context in the header.
- Artifacts are styled from the same tokens as the app, so the token set is a public
  surface: it has to work for hand-authored documents, not only app chrome. The frame
  is sandboxed and has no network access; the UI says so.

## 15. Cross-cutting engineering notes

These caused repeated defects during the design and are worth stating as rules:

- **Derive every count from one source.** Decision counts, worker counts, incident
  counts, project counts and the crumb root must all come from the same data the
  screen renders. Never a literal in a header next to a derived figure in the body.
- **Navigation must preserve scope.** A destination that does not name a scope should
  inherit the current one, never default to global — otherwise a workspace screen
  arrives with a global scope and no rail row matches.
- **Exactly one rail row highlights at a time**, and the header label, the header
  count and the highlighted row are the same fact.
- **Two identically-phrased counts on one screen must not be able to disagree.** If
  one is filtered and one is not, phrase them differently ("6 running · showing 2").
- Any control with a pointer cursor, or any copy promising interactivity, must
  actually work.
