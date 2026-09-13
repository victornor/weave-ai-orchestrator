# Weave AI — Scenarios

Walkthroughs of what the human sees, what the weaver does, what a worker knows and does, and what the daemon does underneath. Written to check that everyone reading `PLAN.md` has the same picture. Each scenario names the plan sections it exercises.

Two invariants hold in every scenario:

- **Isolation.** A worker in project A can never learn anything about project B: not its code, tickets, knowledge base, or existence. The worker's run token, turn prompt, bootstrap digest and filesystem view are all scoped to its own project. The weaver is the only agent that sees the whole portfolio.
- **Knowledge stays small.** Every knowledge file has a token budget, every write is a concise dated entry, and curation rewrites files before they grow past budget. Nothing carries context between sessions except these files, the repo, and the ticket record.

---

## 1. Creating a workspace

**You:** `weave init ~/Work/acme --prefix ACME --name "Acme Labs"` then `weave daemon start` (or the daemon is already running as a user service and picks the workspace up from the registry). Open `weave chat`, the web app, or Telegram.

**You see:** the weaver's first message. It has no projects yet, so it runs a short bootstrap interview: what is this business, who are you and how do you like to be briefed, which projects should it add (git URLs), default CLI per project, whether it may approve plans itself or you approve everything, monthly budget. One question per message. You can also skip it and write `knowledge/workspace/WORKSPACE.md` by hand.

**Weaver does:** records the answers as concise entries in `WORKSPACE.md` (business, your preferences, policies) and `SHARED.md` (house conventions that any worker may see), sets the defaults in `workspace.yaml` through the API, and adds the projects you named (scenario 2, one per URL). Ends with "Ready. Nothing needs you right now."

**Daemon does:** creates the layout (§5), the SQLite DB, the weaver home with its charter and skills, the per-workspace runtime config homes (Claude/Codex/OpenCode/Gemini never touch your personal CLI config), the generated worktrunk config, and a persistent weaver session on the runtime and model you configured.

**Nobody else exists yet.** No roles, no workers.

---

## 2. Adding a project

**You:** in chat, "add github.com/acme/api, default CLI codex", or `weave project add git@github.com:acme/api.git --runtime codex`.

**Daemon does (§12.4, §11.5):** clones into `projects/api/` (reference clone, kept on the default branch), registers the project in the worktrunk config, detects the stack (package manager, test command) to propose `setupCommand`, runs `openspec init` for the configured CLIs if the repo has no `openspec/` yet (as a PR-able change, not a silent commit), creates `knowledge/projects/api/PROJECT.md` from a template with empty sections, and creates a `scout` ticket **ACME-1 "Describe project api"**.

**Weaver does:** tells you the project is cloned and that it is having the project described. It proposes a first role for the project based on the stack ("a Backend Engineer role on Codex; approve to hire") because a scout ticket needs a role to run. It hires it (§10.4): you get a **hire approval** card with the role's charter summary, scope, runtime, model, and a "switch runtime" choice. You tap approve.

**Worker (Backend Engineer #1) knows:** its charter, the brief for ACME-1 ("produce a `report` document describing this project for the knowledge base: overview, stack, commands, conventions, landmines; ≤ 1500 tokens; evidence from the repo"), `SHARED.md`, the empty `PROJECT.md`, and the repo through its worktree `work/` (a worktree of `api` on branch `ac/acme-1-describe-project-api`). It does **not** know that other projects exist.

**Worker does:** reads the repo, runs the test suite once to confirm the commands, writes the `report` document on the ticket, transitions `done`. Because the deliverable is a report, it never pushes.

**Daemon does:** on `done`, seeds `PROJECT.md` from the report (Overview, Stack & commands, Conventions, Landmines), archives the worker, removes the worktree (nothing to land, branch has no commits). Records the diff as PROJECT.md revision 1.

**You see:** "api is set up: Node 22, pnpm, vitest; tests take ~40 s. The Backend Engineer role is ready. Anything you want built?" plus a link to the project page. The weaver's own `WORKSPACE.md` gains one portfolio line: `api — the public REST API; default role: Backend Engineer (codex)`.

---

## 3. Implementing a feature

**You:** "Add dark mode to the dashboard in `web`." (`web` is another project, added earlier, default CLI Claude, with a Frontend Engineer role.)

**Weaver does (§10.3):** resolves the project (`web`, explicit), classifies it as a `change`, creates **ACME-42 "Add dark mode to the dashboard"** with a description (context, request, acceptance criteria drafted from your message and the project KB's Current focus, out of scope), picks the Frontend Engineer role by scope, assigns. Replies: "Ticket ACME-42 created; a frontend worker is drafting the plan. You'll get it for review."

**Daemon does (§11.2):** the role has a free slot, so it spawns **Frontend Engineer #4**: home `workers/<id>/`, worktree `work/` on `ac/acme-42-add-dark-mode` via worktrunk (dependencies pre-warmed from the primary clone), charter + brief rendered into `AGENTS.md`, a fresh Claude session, first wake.

**Worker knows:** its charter (Frontend Engineer for `web`), the brief (ticket text, acceptance criteria, that the OpenSpec change is named `acme-42-add-dark-mode`, delivery mode `pr`, definition of done), `SHARED.md`, `web`'s `PROJECT.md` (stack, commands, conventions, landmines, learnings from earlier workers such as "theme tokens live in `src/theme/tokens.css`; do not hardcode colours"), and the repo in `work/`. It does not know `api` exists.

**Worker, turn 1 (propose):** creates the OpenSpec change in `work/`, runs the propose workflow: proposal, spec deltas, design, tasks. If your request is materially ambiguous (system preference vs manual toggle?) it calls `weave_ask` with the options and a recommendation and ends the turn. Otherwise it requests the `proposed` transition.

**Daemon does (§12.2):** validates the change (`openspec status/validate --json`), writes the plan as a revisioned ticket document, creates a **plan approval** decision owned by you (policy default).

**You see:** one card: "Plan for ACME-42 ready" with the proposal, the task list, the worker's recommendation on the open question if any, and buttons Approve / Revise (with a note) / Reject. On Telegram the same card with inline buttons; in the terminal `weave chat` shows it as a numbered card.

**You tap Approve.** The decision is answered; the daemon moves the ticket to `approved` and wakes the same worker (same session, so it remembers its own proposal).

**Worker, turns 2..n (apply):** implements task by task, ticks `tasks.md`, commits as it goes. If it discovers scope beyond the spec it asks; if it hits the same obstacle twice it reports `blocked` with a routable path. When all tasks are done it pushes, opens a PR with `gh`, records the work product, transitions `in_review`.

**Weaver does:** relays "ACME-42 is ready for review: <PR link>. Frontend worker reports all 7 tasks done, tests green." Creates nothing itself.

**You see:** a **merge approval** card with the PR link and CI state. Approve. (Had you said "build it and merge it when done", the weaver would have created the ticket with **auto-merge** on, this card would not exist, and the daemon would proceed as soon as CI is green, telling you it is doing so. Auto-merge is off by default and the weaver never turns it on by itself.)

**Worker, merge turn (§11.4):** the ticket is `merging`; the worker rebases onto `main` (another worker's dashboard change landed meanwhile), resolves a conflict in `tokens.css`, re-runs tests and lint, pushes with `--force-with-lease`, waits for CI, `gh pr merge --squash`, reports `weave_ticket_merge_done`. In the same turn it writes one learning to the project KB: `2026-09-03 · dark mode: theme switching is done through the `data-theme` attribute on `<html>`; component-level overrides break it.`

**Daemon does:** verifies the merge on the forge, fast-forwards `projects/web`, runs `openspec archive --yes --json` on the default branch and pushes the archive commit, runs the landed-work test, removes the worktree, retires the worker, ticket `done`, cost rolled up.

**You see:** "Dark mode landed in web (PR #212 merged)." Nothing else; no mechanics. The ticket page shows what it cost: tokens per turn, the model used, and the estimated dollars.

**Where everything lives afterwards:** the change is in `web`'s git history and OpenSpec archive; the ticket holds the plan, comments, PR and cost; `PROJECT.md` has one new line; the worker's home is in `archive/workers/`; the runs are in the run log.

---

## 4. Asking a question about a project

**You:** "How does `api` handle auth today?"

**Weaver does:** answers from `api`'s `PROJECT.md` or from the spec index (`weave_spec_search`, which finds the `auth` capability's requirements and the changes that shaped them) if those cover it. If not, it creates a `question` ticket **ACME-43 "How is auth handled in api?"** assigned to the Backend Engineer role and says "Asking a backend worker; back shortly."

**Worker knows/does:** charter, brief (the question, "answer as a ticket comment with `file:line` evidence; do not change code"), `PROJECT.md`, `SHARED.md`, the repo in a worktree on a throwaway branch. It answers in a comment and transitions `done`. Optionally adds one concise line to the KB Overview if the KB was missing something basic.

**You see:** the answer in the weaver's words, with the file references, and the ticket link. The worker is retired; the worktree removed (no commits).

---

## 5. A bug report you are not sure about

**You:** "Users report the export is sometimes empty in `api`. Not sure why."

**Weaver does:** this is uncertainty that would change what to build, so it creates a `scout` ticket **ACME-44 "Investigate empty exports"** (not a `change`). Says so: "Having a backend worker investigate first; you'll get findings, not a fix."

**Worker does:** reproduces in its worktree (may install, run, add temporary logging, make scratch commits on its branch; never pushes), writes the `report` document (what it did, what it found, evidence, recommendation), transitions `done`.

**Weaver does:** reads the report as evidence, not authorization. Presents you the findings and a recommendation: "Root cause is a race in the export queue; the fix is small and clear. Create the fix ticket?" One decision card.

**You:** approve. The weaver creates `change` ticket ACME-45, links ACME-44 as its parent, assigns the role; a new worker starts from a fresh worktree with the report in its brief's context pointers (it can read the parent ticket's report; it cannot see the scout's worktree, which was removed).

---

## 6. A feature that spans two projects

**You:** "Add an `/export/stats` endpoint in `api` and a page that shows it in `web`."

**Weaver does (§12.5 planning):** two deliverables with different owners and a hard dependency, so two tickets: **ACME-46 (api) "Add /export/stats endpoint"** and **ACME-47 (web) "Stats page"** with `blockedBy: [ACME-46]`. Assigns each to its project's role. Tells you both are queued and that the web page waits for the endpoint.

**Isolation in practice:** the api worker's brief describes the endpoint contract (paths, fields) as the acceptance criteria. It never sees `web`. The web worker, when it starts later, gets the same contract in *its* brief plus the api ticket's final comment (the weaver copies the relevant part into ACME-47's description; the web worker cannot read ACME-46). Each works in its own project's worktree. If the web worker needs a field the endpoint does not return, it goes `blocked` with owner `weaver` and the exact ask; the weaver creates a follow-up ticket in `api` (courier pattern) and tells you only if it changes scope or timing.

**Daemon does:** when ACME-46 reaches `done`, `blockers_resolved` fires, ACME-47 moves to `todo`, a web worker spawns.

---

## 7. A worker gets stuck, or needs a decision

**Needs a decision:** mid-implementation the worker finds the spec implies deleting a legacy table. It calls `weave_ask("ACME-45", {title: "Drop legacy export_jobs table?", options: [keep, drop], recommendation: keep, ...})` and ends its turn. The decision is a `gate_finding` owned by the weaver by policy. The weaver decides toward the accepted design when unambiguous ("keep; not in scope") and the worker is woken with the answer; you never see it. If it is a real product call, the weaver escalates to you as one card with its recommendation.

**Genuinely stuck, not deciding anything:** a different worker finds the ticket's stated fix does not actually reproduce the bug going away. Framing that as options ("keep trying / give up"?) would be dishonest, so it calls `weave_ask("ACME-45", {kind: "concern", title: "The stated fix doesn't close the bug", context: "Tried X and Y per the ticket; Z still reproduces. Need a second look before I keep going.", ...})` and ends its turn. It reaches the weaver immediately, the same as the `gate_finding` above — never your queue, whichever of the two the worker names. The weaver answers directly if it already knows enough (it may have seen the same root cause on a related ticket), or escalates to you with its own `weave_ask` and tells the worker, on its ticket, that it is now waiting on you rather than leaving it to wonder.

**Stuck:** the worker stops producing events for 10 minutes and its worktree has no new writes. The supervisor interrupts, then kills the process group, and relaunches the same worker into the same home and worktree with its brief plus a progress note ("tasks 1–4 ticked; uncommitted changes in `src/export.ts`; last status: working"). Second failure: new session, bootstrap digest. Third: worker `error`, ticket `blocked`, weaver woken with the evidence; it may cancel and reassign (a new worker starts from the existing branch). You are told only at this point: "The backend worker on ACME-45 stalled twice; I've restarted it with a fresh session. If it fails again I'll ask you."

---

## 8. Talking to a worker

**You:** on the ticket page, in `weave attach <worker>`, or on Telegram after `/talk ACME-42`: "Use the existing `useTheme` hook, don't add a new one."

**Daemon does:** stores the message as a human comment on ACME-42, wakes the worker (`ticket_comment`).

**Worker does:** reads it in `weave_inbox`, adjusts, replies with a ticket comment ("Switched to `useTheme`; two components updated."). The daemon relays the comment to your bound thread and the web page. Everything you said to each other is on the ticket, visible to the weaver, and survives the worker's retirement. The worker still has no way to message you outside its ticket, and no way to see any other ticket.

---

## 9. Knowledge curation

**Trigger:** `web`'s `PROJECT.md` crosses 80 % of its 1500-token budget after a month of learnings, or 14 days pass, or you run `weave knowledge curate web`.

**Daemon does:** creates `task` ticket **ACME-60 "Curate project knowledge (web)"** with `noWorktree: true` and spawns a curation worker from the Frontend Engineer role with a fresh session and a read-only checkout of the primary clone as `work/` for fact-checking.

**Worker does (skill `weave-ai-knowledge`):** merges duplicates, folds learnings that became conventions into Conventions, removes entries now stated in the repo's own docs or contradicted by the code, archives stale ones, tightens wording, keeps every section within its share of the budget. It never adds facts. It submits the new file with `weave_knowledge_replace`.

**Daemon does:** diffs, archives every removed entry with date/author/reason to `knowledge/projects/web/archive/`, records the diff on the ticket, marks the file curated. `weave knowledge revert web 7` restores a previous revision if you disagree.

**Workspace files** are curated the same way by the weaver in a dedicated turn. `decisions.md` is trimmed to recent durable decisions; older ones move to the archive.

**You see:** nothing unless you look; `weave knowledge lint` and the project page show sizes, budgets and last curation. Bootstrap cost per worker stays flat over the life of the workspace.

---

## 10. Working from a Hyprland desktop

**You:** set `presentation.workers = { surface: hyprland, workspace: 5, layout: grid }` and `presentation.conductor = { surface: terminal }` in `workspace.yaml`, or via settings.

**Daemon does (§14b.3):** applies a runtime window rule with `hyprctl keyword windowrule` (re-applied on start and reconcile, never written to a config file). When a worker spawns, it opens your default terminal (`$TERMINAL`, here foot) with `weave attach <worker>` on workspace 5; the window title reads `Frontend Engineer #4 · ACME-42 · working`. When the worker is retired the window closes after a short grace. `weave chat` opens in a terminal on your current workspace.

**You see:** workspace 5 is a live grid of whatever is being worked on right now, one window per worker, each showing the transcript and accepting comments on that ticket. The weaver is a terminal beside your editor. The web app shows exactly the same state if you open it on your phone. Switching `surface: herdr` moves the same workers into a herdr workspace with a tab per project and a pane per worker, without restarting anything.

---

## 11. Restart mid-work

**What happens:** you reboot while three workers are running. On daemon start, runs whose processes are gone are marked `interrupted`, their wakes are re-queued once, worktrees and homes are exactly where they were (nothing is ever reset), sessions resume. Workers pick up with a "you were interrupted" note in the turn prompt. Windows on workspace 5 are recreated by reconcile. The weaver's next digest mentions nothing unless a run actually failed.

---

## 12. Looking at usage

**You:** open Usage in the web app or run `weave usage --scope project:web --window 7d --grain day`.

**What you see:** tokens (in, out, cached) and cost for the whole workspace and per project over the last 24 hours, today, this week, this month or a custom range, at hour/day/week grain; the share each project takes; per-ticket cost with the subtree rolled up and a per-turn breakdown; per-model usage (which models are used, by whom, and how the mix changes over time); per-role and per-worker; runs per day with success and recovered counts. Cost is always labelled reported or estimated; tokens are the headline number. Nothing here ever blocks work: there are no budgets in v1.

---

## 13. Starting work from your phone

**You:** open the installed PWA, tap **Chat** in the bottom bar, tap the microphone, say "In api, make the export endpoint stream results instead of buffering, and merge it when it's done." Tap send after glancing at the transcript.

**Weaver does:** creates the `change` ticket in `api` with **auto-merge on** because you said so, assigns the Backend Engineer role, replies with the ticket link.

**You see:** later, a plan card as a push notification; you approve it one-handed. Then "Streaming export landed in api (PR #88 merged)." No merge card, because auto-merge was on.

---

## 14. Daemon on a server, work from anywhere

**Setup once (on the server):** install Weave AI, `weave init`, `weave daemon set-password`, `weave runtime login claude` and `weave runtime login codex` (device-code flows, stored in the per-workspace config homes), `gh auth login`, SSH key for git, `weave daemon install-service`, DNS `conductor.example.com` → server, ACME on. `weave doctor` is green.

**From your laptop:** `weave login https://conductor.example.com --name laptop` (password, then the TOTP code), `weave context use laptop`. Every command now runs against the server: `weave chat`, `weave ticket list`, `weave attach <worker>`. Start `weave presenter --surface hyprland --workspace 5` and the workers running on the server appear as terminal windows on your laptop's workspace 5, each streaming its transcript over the network; close the laptop and they keep working, because nothing runs on the laptop.

**From your phone:** open `https://conductor.example.com`, log in once, install the PWA. Open the chat, dictate, approve plan cards from notifications. Same state as the laptop and Telegram.

**Security posture:** plaintext is refused off-loopback; five failed logins lock the account for 15 minutes; devices are listed and revocable in Settings; the agents' MCP endpoint is not reachable from outside the server at all.

---

## 15. Exploring specs

**You:** open Knowledge & Specs → `web` → capability "theming".

**What you see:** the capability's requirements and scenarios as they stand on `main`; the requirement added by ACME-42 marked with the ticket and PR that introduced it; a pending delta from ACME-51 (in progress) highlighted, linking to that ticket's plan; the change history for the capability; and a graph view where capabilities, changes and tickets are nodes, filterable by time and status. Search finds text across specs and knowledge bases in one box. Everything is read-only here: specs change only through tickets. `weave specs show theming` gives the same in the terminal.
