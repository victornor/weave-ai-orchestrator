# Design brief for OpenConductor (paste into Claude Design)

You are designing the web front end of **OpenConductor**, a control plane for AI coding agents working across several git projects. Produce a complete, high-fidelity, clickable mockup of the app for **phone first, then desktop**, in **both light and dark mode**, following the design language in section 5. Every screen must answer, in order: *what is happening, does it need me, what do I do about it.*

---

## 1. What OpenConductor is

A **workspace** is a virtual business: one or more git **projects** (cloned repos), one **conductor** agent the human talks to, and hired **roles** per project (e.g. "Backend Engineer" on the `api` project). Roles are templates; when a ticket is assigned to a role, the system spawns a disposable **worker** for that one ticket, in its own git worktree, with its own AI session. Concurrency is simply more workers. When the work has landed the worker is retired.

Work is organised in **tickets** (`ACME-42`), created by the human or by the conductor from what the human says. Ticket kinds: `change` (code, goes through a plan → approval → implementation → PR → merge flow), `task` (chore, no plan), `scout` (investigation; deliverable is a report, not code), `question`.

Ticket statuses, each naming who owns the next move: `backlog`, `todo`, `proposing` (worker writing the plan), `proposed` (plan awaiting the human's approval), `approved`, `in_progress`, `in_review` (PR open, awaiting the human's merge approval unless auto-merge is on), `merging` (the worker rebases, resolves conflicts, merges), `blocked` (with a named owner and action), `done`, `cancelled`.

**Decisions** are the single human-in-the-loop primitive: plan approval, merge approval, hire approval, a worker's question (with options and a recommendation), a discard confirmation. One decision per card. Answers: approve / revise with a note / reject, or pick an option, or free text.

**Isolation:** a worker knows only its project, its ticket, the project knowledge base and a project-agnostic shared conventions file. The conductor sees everything. The UI must never imply a worker can see another project.

**Knowledge bases:** a workspace KB (conductor's) and one KB per project (workers read and write concise dated notes; curated on a schedule so it never grows past a token budget). Both are markdown files with revision history. **Specs:** every `change` ticket produces OpenSpec documents (proposal, design, tasks, spec deltas); after merge the deltas are folded into the project's main specs, which are the source of truth for how the product behaves. Specs are indexed and explored next to the knowledge base.

**Chat exists in two places only:** with the conductor (the default view) and with a live worker *through its ticket* (comments on the ticket wake the worker; its replies are ticket comments).

**Usage:** the system records tokens (in/out/cached), model, duration and cost (labelled reported or estimated) for every run, attributed to workspace, project, role, worker, ticket and model. There are no budgets; nothing blocks on spend. Usage is surfaced over windows (last 24 h, today, this week, this month, custom) at hour/day/week grain.

**Surfaces:** the same state is also visible in a terminal TUI and, for power users, as terminal windows per worker on a Linux desktop. The web app must feel like the same product: same status vocabulary, same glyphs.

---

## 2. Screens to design

Design the phone layout of every screen first, then the desktop layout. Navigation: bottom bar on phone (Chat · Board · Team · Needs you · More), left rail on desktop. A persistent **Start Work** action everywhere (bottom bar centre on phone; a button plus shortcut `⌘⇧Space` on desktop).

1. **Chat (default).** A thread with the conductor: streamed replies, inline **decision cards**, ticket chips that expand inline, worker chips with live status ("Backend Engineer #7 · running tests"), slash commands (`/talk ACME-42`, `/brief`). **Composer**: text input plus a **microphone** for voice dictation (tap-to-toggle on phone, push-to-talk with the shortcut on desktop), live editable transcript, send. The composer is reused everywhere the human writes. Design the "busy" state: the human sends while the conductor is mid-turn; the message is queued and the UI says so.
2. **Start Work.** Tapping it opens the composer focused, with the mic ready and three quick chips (Feature · Bug · Question) that only set the kind hint. Show the flow: dictate → transcript → send → the conductor's reply with the created ticket chip → (later) a plan card arrives as a push notification.
3. **Decision cards** (in chat, in the Needs-you inbox, as push notifications). Variants: plan approval (proposal summary, task list, buttons Approve / Revise with note / Reject); merge approval (PR link, CI state, diff stats, Approve / Hold); hire approval (role name, one-sentence charter, scope, runtime + model, a "switch runtime" choice, Approve / Reject); worker question (context, options with a recommended one first, free text allowed); discard confirmation (destructive; needs a typed confirmation). Cards must be one-hand usable on a phone.
4. **Needs you** inbox: every open decision, newest first, with the same cards; empty state "Nothing needs you right now."
5. **Board.** Tickets per project as columns by status (phone: a status filter and a list; desktop: kanban and a table view). Filters: project, role, kind, priority, blocked-on-me. Each card: identifier, title, status, worker, age, a tiny usage figure.
6. **Ticket page.** Header (identifier, title, kind, status, project, role/worker, priority, **auto-merge toggle** default off). Tabs: Overview (description, acceptance criteria, blockers graph), Plan (revisioned document with inline Approve/Revise; highlight what changed between revisions), Activity (comments from human/worker/system, run-attributed; the composer at the bottom posts a comment that reaches the worker), Work (PR with live CI, branch, OpenSpec task progress e.g. 5/7 ticked, worktree state), Usage (tokens and cost per turn, subtree rollup).
7. **Team.** Org view: conductor → projects → roles → live workers. Role card: name, status, runtime + model (dropdown from the runtime's model list), max workers, charter with revision history and rollback, pause/resume/retire. Worker card: role, ticket, phase, worktree state (clean/dirty, ahead/behind), last status line, usage; opens the **Worker page**.
8. **Worker page.** Live transcript (assistant text, tool calls collapsed into one line each with expand, file diffs, status lines), brief (read-only), steering composer (posts a ticket comment), relaunch / cancel. Must be readable on a phone.
9. **Runs.** Timeline across workers; run page with transcript, phase timings, usage, raw event download.
10. **Usage.** Workspace total and per-project series over the selected window and grain; project share; top tickets by cost with subtree rollup; per-model usage and model mix over time; per-role/worker; runs per day with success and recovered counts. Tokens are the headline number; cost is secondary and labelled reported/estimated. Design the window/grain picker once and reuse it.
11. **Knowledge & Specs.** One section with one search box across both. *Knowledge*: the workspace KB and each project KB as readable markdown with a size/budget meter, last-curated date, revision history and revert, a "curate now" action. *Specs* (every feature leaves an OpenSpec spec behind; after merge they are the source of truth): per project a capability list (requirement counts, last change), a capability page (requirements and scenarios, pending changes from active tickets highlighted and linked, change history to tickets and PRs), a change page (proposal, design, tasks with progress, delta specs; active and archived), and a **graph view** of capabilities ↔ changes ↔ tickets over time (a node network; make it useful, not decorative: filter by time and status, click a node to open it). Read-only.
12. **Settings.** Workspace (name, prefix, defaults), Projects (add via git URL, default runtime, max workers, setup command, auto-merge default), Conductor (runtime, model dropdown, channels), Channels (Telegram config), Presentation (surface selection: headless / tmux / herdr / Hyprland with detection status), Plugins, workspace switcher.
13. **Onboarding.** First run: the conductor's bootstrap interview as a chat (business, how you like to be briefed, projects to add, default CLI per project, approval policy), one question per message.
14. **Empty, loading, error states** for every screen: skeletons with real structure, no spinner-only states; errors show a typed code and a next step.

---

## 3. Scenarios the mockup must walk through (make these clickable paths)

- **Ship a feature from the phone.** Start Work → dictate "add dark mode to the dashboard in web" → conductor reply with ticket chip ACME-42 → notification: plan card → Approve → later: merge card → Approve → "Dark mode landed in web (PR #212 merged)". Then open the ticket's Usage tab.
- **The same with auto-merge.** Dictate "…and merge it when it's done" → the ticket shows auto-merge on; no merge card; the conductor says it is merging once CI is green.
- **Add a project.** Settings → Projects → paste git URL → the conductor proposes a first role → hire card → approve → the project page fills in as the scout worker describes it.
- **A worker asks a question.** Card with two options and a recommendation; answer one-handed; the worker continues.
- **Talk to a worker.** Ticket → Activity → composer → the reply arrives as a comment; also the Worker page transcript updating live.
- **Cross-project feature.** Two tickets with a blocker edge shown on the Board and on each ticket's Overview; the second starts when the first is done.
- **Something got stuck.** Worker card turns to "stalled, relaunching"; then "blocked: needs you" with a card.
- **Usage review.** Switch the window to "this week", grain "day", compare projects, drill into a model.
- **Explore a spec.** Knowledge & Specs → project `web` → capability "theming" → see the requirement added by ACME-42 with a link to the ticket and PR → open the graph and find which other changes touched theming.

---

## 4. Status vocabulary (use identically everywhere: badges, rows, cards, charts, transcript lines)

`idle` · `working` · `blocked` · `needs-you` · `merging` · `done` · `failed` · `paused` · `stalled`. Each has one colour token and one glyph. Never invent a second set.

---

## 5. Design language

**Linear-grade.** Use Linear (the issue tracker) as the reference for UI and UX quality: fast, calm, keyboard-first, information-dense without clutter. Do not copy Linear's brand or copy its screens; match its standards and idioms, and design **light and dark modes as equals** (the dark theme is designed, not inverted).

- Layout: slim left sidebar (workspace switcher, navigation, projects), list-or-board main pane, a details pane that slides in for the selected item. On phone: stacked views, bottom bar, thumb-reachable primary actions. Everything reachable in two keystrokes on desktop and two taps on phone.
- Type: one clean sans (Inter or the system UI stack) at a tight consistent scale; monospace only for machine values (ids, tokens, timestamps, code). Tabular numerals.
- Surfaces: subtle 1 px borders and very light elevation, small radii (4–6 px), no heavy shadows or gradients. Hierarchy through spacing, weight and colour.
- Colour: neutral greys with one accent, plus the status set in section 4 rendered as Linear-style status glyphs (ring/progress icons) and colour tokens used identically everywhere. Provide the full token sheet for both themes.
- Interaction: instant optimistic updates, streamed text, a `⌘K` command palette that does everything (create ticket, jump, filter, change status, switch workspace), shortcuts on every list (j/k, enter, `c` create, `a` assign…), inline editing, hover actions that are also keyboard-reachable. Micro-interactions ≤ 150 ms, reduced-motion honoured.
- Density: lists show many rows with clear scan lines; details never hide behind clicks that a hover or keystroke could reveal. Empty states are short and actionable.
- Machine values (ids, tokens, timestamps, costs) formatted consistently, set in mono.
- Accessibility: full keyboard operation on desktop, large tap targets on phone, ARIA on cards, contrast that passes on both themes.
- Mobile is first-class: installable PWA, bottom navigation, one-hand decision cards, push notifications for decisions and landed work, voice dictation.

Inspiration: Linear for layout, interaction and polish; Paperclip for the operator-control-plane stance (org, tickets, runs, approvals; tokens as the single visual source; systematic status vocabulary); Cursor's cloud workers for input ergonomics (start work, dictate or type, get notified). The result should read as its own product.

---

## 6. Deliverables

- Phone and desktop layouts for every screen in section 2, with the states in item 14.
- The clickable scenario paths in section 3.
- A token sheet for **both themes**: colours (surfaces, text, accent, the status set), type scale, spacing scale, radii, borders, the status glyph set, motion durations.
- Component sheet: composer with mic, decision card variants, ticket card, worker card, transcript line types (assistant, tool call collapsed/expanded, file diff, status), window/grain picker, budget/size meter, empty/loading/error patterns.
- Notes on anything in this brief you found ambiguous, with the choice you made.
