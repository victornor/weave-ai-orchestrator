# Follow-up brief 1 for the AgentConductor mockup

> Moved verbatim from `docs/design/claude-design-followup-1.md` in the agent-conductor repository on 2026-09-07 (VS-91); internal design documentation, not published. It extends [[design-claude-design-prompt]]; the resulting mockup is transcribed in [[design-design-contract]].

Two additions to the brief you already have. Keep everything else as designed; extend the same token sheet, status glyphs and component sheet. Phone first, desktop second, both themes.

## A. Knowledge & Specs (extend screen 11)

Every `change` ticket produces OpenSpec documents (proposal, design, tasks, spec deltas). After the ticket merges, the deltas are folded into the project's **main specs**, one per capability (e.g. `theming`, `auth`, `export`), which are the source of truth for how the product behaves. Specs are therefore knowledge, and they are explored next to the knowledge base in one section with one search box. Specs are **read-only** here; they change only through tickets.

Design these views:

1. **Knowledge & Specs home** (per workspace, with a project switcher). Left: the workspace KB and each project's KB (as before: markdown, size/budget meter, last curated, revision history, revert, "curate now"). Right or below: each project's **capabilities** as a list with requirement count, last change date, and a small indicator when a pending change touches it. One search box that returns mixed results (KB entries, capabilities, requirements, change artifacts), each result labelled by kind and project.
2. **Capability page.** The spec as it stands on the default branch: title, purpose, then requirements each with its scenarios (collapsible). **Pending deltas** from active tickets are highlighted inline (added / modified / removed) with a chip linking to the ticket and its worker. A **change history** rail: archived changes that touched this capability → their tickets → their PRs, newest first. Actions: open the raw file, copy link, jump to the graph focused on this node.
3. **Change page.** For an active or archived change: proposal, design, tasks (with progress, e.g. 5/7), and its delta specs grouped by capability. Header shows the ticket, worker, status, PR. Archived changes show the archive date and the resulting main-spec revisions.
4. **Graph view.** A node network of capabilities ↔ changes ↔ tickets for one project. Nodes carry the status colour; edges are "touches" (change → capability) and "belongs to" (change → ticket). Filters: time range, status, capability search; click a node to open its page in the details pane; keyboard navigation between neighbours. It must be useful on a laptop and at least readable on a phone (a simplified list-of-neighbours mode is acceptable there). Do not make it decorative.
5. **TUI parity note.** The same information exists in a terminal view; keep the hierarchy simple enough that a list-based rendering of each page is obvious.

Clickable path to add: Knowledge & Specs → project `web` → capability "theming" → requirement added by ACME-42 with its ticket and PR → pending delta from ACME-51 → graph focused on theming.

## B. Remote access (new screens and states)

The daemon runs on a server; the web app and phone reach it over the internet. Design:

1. **Login.** Username, password, then a second step for a 6-digit TOTP code when two-factor is on. "Remember this device" names the device (e.g. "Victor's phone"). Error states: wrong password, locked out for 15 minutes after five failures (show the remaining time), expired session. No sign-up: there is exactly one operator account, created on the server. First-run on a fresh daemon shows a short "set your password" screen instead.
2. **Settings → Security & Devices.** Change password, enable/disable two-factor (QR + recovery codes), list of devices/sessions (name, kind: web/CLI/presenter, last seen, IP, this device), revoke one or all. A CLI hint: `conductor login https://…`.
3. **Connection state.** A subtle, consistent indicator for: connected (nothing shown), reconnecting (thin banner, no modal), offline (read-only view of the last state with a timestamp, composer shows "will send when back online" and queues messages), and server unreachable at load. Streaming transcripts and the board must degrade gracefully.
4. **Notifications.** A first-time prompt to enable push notifications (decisions and landed work), phrased in outcomes; a Settings toggle; the notification itself as a card preview on the lock screen (plan ready, merge ready, needs you).
5. **Dictation unavailable.** When the browser has no speech API and the server has no transcription provider, the mic button shows a short explanation on tap and the composer stays usable.

Clickable path to add: cold open on a phone → login with TOTP → "remember device" → Needs-you inbox → Settings → Security & Devices → revoke the laptop's session.

## Deliverables

Same as before, extended: the new screens in both layouts and themes, the two clickable paths, additions to the token sheet (graph node/edge styles, connection-state banner) and component sheet (search result row by kind, requirement block with scenarios, delta highlight, change-history rail, device row, TOTP input).
