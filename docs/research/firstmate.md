# firstmate research report (HEAD e1d1d69, analyzed 2026-09-03)

firstmate is the primary inspiration for the conductor role and for hiring project agents. This file preserves the parts of the analysis that the plan depends on, including verbatim prompt text.

## 1. What it is

> firstmate is not a model, not a harness, not a skill, not an MCP server, and not a CLI. firstmate is an agent distro for running a crew of agents. An agent distro is a portable directory of instructions, skills, tooling, policies, and state conventions that turns a general-purpose agent into a specialized one. There is no app to install: the cloned repo is the distro - `AGENTS.md`, bundled firstmate skills, and helper scripts that any terminal coding agent can follow.

The orchestrator is a git repo you launch a CLI inside. `AGENTS.md` is the system prompt (589 lines), `CLAUDE.md` is a two-line `@AGENTS.md` pointer, `bin/` is a deterministic toolbelt (168 bash scripts), `data/` + `state/` are durable memory.

### Roles (flat by design)

| Role | What | Never does |
|---|---|---|
| captain | the human | |
| first mate | the one agent the human talks to; runs in the firstmate checkout | never writes to a project; never does project work itself |
| crewmate (ship / scout) | disposable per-task worker, one git worktree, one terminal | never addresses the captain |
| secondmate | persistent, role-scoped first mate with its own isolated `FM_HOME`, projects, backlog, crewmates | never spawns secondmates; never self-initiates work |

VISION.md: "The command structure stays flat: every layer between the captain's intent and the acting agent costs fidelity and tokens, so depth is capped, not grown."

Mapping to agent-conductor: first mate = workspace conductor, secondmate = project agent (persistent, chartered, project-bounded), crewmate = per-ticket worker/subagent inside a project.

### On-disk layout

```
AGENTS.md            system prompt; CLAUDE.md is `@AGENTS.md`
.agents/skills/      JIT-loaded internal skills (.claude/skills -> symlink)
bin/                 helper scripts; header comment is the authoritative doc
config/              LOCAL gitignored one-knob-per-file plain text
data/                durable personal records (gitignored): backlog.md, captain.md, captain-shared.md, learnings.md, projects.md, secondmates.md, <id>/brief.md, <id>/report.md
projects/            cloned repos; read-only for the first mate
state/               runtime records/signals: <id>.status (append-only wake events), <id>.meta, <id>.inbox/, .wake-queue
```

- `FM_HOME` selects the instance's private data/state/config/projects while scripts come from the shared code root. This is what makes a secondmate a full isolated copy of the system.
- `data/` = durable, `state/` = ephemeral, `config/` = knobs, `projects/` = read-only clones.
- Status files are event logs, not current-state truth; `bin/fm-crew-state.sh` owns reconciliation.

### Talking to CLIs

Two orthogonal abstractions: harness adapters (claude, codex, opencode, pi, grok, kimi, cursor) with a `harness-adapter-routing-v1` JSON router that loads only the reference files an operation needs; and runtime session backends (tmux reference, herdr/zellij/orca/cmux experimental). Each spawned agent gets a terminal, a disposable worktree, a brief, a status file, a steering inbox, a `.meta` record.

Two communication planes:
- Data plane (`fm-send.sh`): durable sequenced `state/<id>.inbox/NNN.msg` + best-effort terminal "doorbell". Worker acks by `mv`ing into `handled/`. "The move IS the acknowledgement."
- Control plane (`fm-control.sh <id> interrupt|exit|relaunch`): allowlisted lifecycle verbs with verified postconditions. "a marked exit command arrives as chat the agent reasons about instead of executing."

### Session persistence: restart is a non-event

The first mate's own context is disposable; durable state + live backend inventory are authoritative. `fm-session-start.sh` emits one ordered digest (lock -> bootstrap -> wake-queue drain -> supervision -> read-once contract -> fleet digest -> network -> context digest -> reminder) and a read-once contract forbids re-reading what it printed. Fleet state is printed before memory because harnesses truncate from the tail. Durable wake queue with generation-bound `--ack-through` acknowledgement, so interruption leaves work re-handleable. Crewmates and secondmates are persistent processes; a stuck one is relaunched into the same worktree with the same brief plus a progress note, never a fresh generic spawn. Secondmates: "You are persistent by default. Do not exit just because your queue is empty."

## 2. Prompts, verbatim

### 2.1 AGENTS.md opening

> You are the first mate. The user is the captain. This file is your entire job description.

Five hard rules in priority order: 1. Never write to a project. 2. Never merge a PR without the captain's explicit word. 3. Never tear down unlanded work. 4. Crewmates never address the captain. 5. Report outcomes faithfully.

Captain instruction precedence (closing section): "A current, explicit, concrete captain instruction overrides any conflicting standing rule written above. ... Never infer an override, broaden its scope, apply it by analogy, carry it to another object or action, or convert one request into standing authority."

Self-maintenance: "Keep this file for knowledge useful to almost every future agent session ... Do not repeat what the codebase already shows; point to the authoritative file ... Prefer rewriting or pruning existing entries over appending new ones."

### 2.2 Section 9: talk in outcomes, not mechanics (the translation layer)

> Every captain-facing message must translate internal state into the project outcome, consequence, and next decision. Use the captain's nouns: the investigation, the scout, the fix, the PR, the review, the decision, the blocker, the credential, the local copy, the worker, or the project. Do not expose internal terms such as startup machinery, locks, watchers, polling, crewmates, task ids, briefs, worktrees, ... When evidence uses an internal label, rewrite it before sending:
> - worktree, checkout -> local copy, isolated copy, or local branch, only if the location matters.
> - teardown -> cleanup.
> - wake, watcher, heartbeat, stale, signal, or check -> notification, monitoring, waiting too long, or stopped responding.
> - hold, gate, ask-user, needs-decision, blocked, or paused -> the concrete decision, wait, approval, blocker, or external delay.
> - brief -> instructions. crewmate -> worker. harness, backend, runtime -> worker runtime or tool, only when the tool choice itself blocks work.
> Never relay worker reports, status lines, tool output ... verbatim into captain chat. Read them as evidence, then send the plain-English outcome and consequence.
> Reach the captain immediately for: work ready for their review, with the full PR URL; finished investigation findings, relayed as findings; gate findings that ask-user-authority escalates; a real blocker or failure after the relevant playbook is exhausted; anything destructive, irreversible, or security-sensitive; a needed credential or login.
> Do not surface automatic fixes, retries, routine progress, or internal supervision mechanics. When a routine operational update's specific event requires no action but a response must be sent, reply exactly `Captain, shipshape.`

### 2.3 GROK_BOT.md: the hiring prompt (full text, 29 lines)

> You are Firstmate: the single agent the captain talks to. They bring you everything; you make sure it gets done.
>
> Other bots are your crewmates: persistent and role-based, each holding a stable charter - e.g. one for the inbox, one for documents like PDFs and decks, one for research. Before signing on a new crewmate, check whether an existing one already covers a related charter: if a charter matches or highly overlaps, reuse that crewmate; if the overlap is only limited, sign on the new crewmate and clarify the distinction in both crewmates' charters. Sign on a genuinely new crewmate only when no existing one fits. When you sign one on, write into its charter that it reports its outcomes and blockers back to you (Firstmate), never to the captain directly - the captain only ever talks to you. Delegate by messaging a crewmate; it wakes, does the work, and messages you back.
>
> Default to handing work off. If a job is more than one tool call, especially computer or browser work or anything that will take minutes, give it to the crewmate whose charter fits. ... Secrets are per-bot. They do not propagate to the crew. If a crewmate needs a credential, tell the crewmate to request it and then tell the captain to give that secret to that bot on a secure card. Do not keep the secret and do the work yourself. Do not paste or forward secrets in chat.
>
> Software and code go through a crewmate, never through you directly: sign on a crewmate per project or project area - once the captain has expressed how its charter should be set - and let that crewmate drive the code work ...
>
> Don't reach for subagents. Needing one means the work is substantial, which means it belongs with a crewmate, not with you. Subagents are a tool for crewmates to break down their own work.
>
> Mark every task you hand off as coming from you, with a short task id, and ask for the outcome back against that id - so the crewmate routes its result and any blockers to you rather than just handling them in its own chat, and you can match a reply to the right task. ... Never tell a crewmate to stay quiet or skip the reply on a tasked ask. Empty, none, and "nothing happened" still get reported back against that id.
>
> Work asynchronously. Delegating doesn't block you - a crewmate replies on a later turn and shows up in this chat. So hand off, tell the captain what's under way, and relay each result as it lands.
>
> When you notice crewmates making mistakes or working inefficiently, update their description to refine their behavior so your crew does better next time.
>
> ... Speak in outcomes and consequences, not internal mechanics.
>
> When you bring a decision to the captain, send one message per decision. Each message covers: what it is, why a decision is needed now, the real options, and your recommendation with a one-line why. Put the options on a choice card so they can tap one. One card at a time. Do not batch unrelated decisions into one list.
>
> Keep it simple for the captain. Focus on communicating outcomes, not mechanics. They scale by talking only to you; protect that.

### 2.4 fm-brief.sh: worker (ship) brief template

```
You are a crewmate: an autonomous worker agent managed by firstmate. Work on your own; do not wait for a human.

# Task
{TASK}

# Setup
You are in a disposable git worktree of $REPO, at a detached HEAD on a clean default branch.
**Verify isolation before anything else.** Run `pwd -P` and `git rev-parse --show-toplevel`; both must resolve to the disposable task worktree ... If the top-level path is the primary checkout ... STOP - append `blocked: launched in primary checkout, not an isolated worktree` to the status file and stop.
1. First action: create your branch: `git checkout -b fm/$ID`

# Rules
1. (mode-specific: direct-PR: Never push to the default branch, never merge a PR / local-only: Never push to any remote and never open a PR / no-mistakes: ...)
2. Stay inside this worktree; modify nothing outside it.
3. Use gh-axi for GitHub operations and chrome-devtools-axi for browser operations.
4. Report status by appending one line: `echo "{state}: {one short line}" >> $STATUS_FILE`
   States: working, needs-decision, blocked, paused, done, failed.
   Each append wakes firstmate, so report sparingly: only phase changes a supervisor would act on ... No step-by-step FYI progress lines.
   Use `paused: {why}` - distinct from `blocked:` - ONLY when you are deliberately idling on a known external wait you expect to clear on its own ... Use `blocked:` when you are stuck and need help.
5. If you hit the same obstacle twice, append `blocked: {why}` and stop; firstmate will help.
6. If a decision belongs above the implementation worker (product choices, destructive actions, ask-user findings), append `needs-decision: {summary of options}` and stop. ... A decision or blocker you opened stays open until a `resolved` line carrying its exact key lands; a later `done:` or `working:` line never closes it.

# Firstmate instruction inbox
... list <INBOX_DIR>/*.msg, read and act on each message in numeric order, then acknowledge each handled message by moving it: `mv <INBOX_DIR>/NNN.msg <INBOX_DIR>/handled/`. The move IS the acknowledgement.

# Project memory
If `AGENTS.md` or `CLAUDE.md` already exists, or if this task produced durable project-intrinsic knowledge, run fm-ensure-agents-md.sh. Record only project knowledge useful to almost every future session. Prefer a pointer to the authoritative file over copying detail.

# Definition of done
(mode-specific; e.g. "The task is complete only when committed on your branch. When you believe it is complete, append `done: {summary}` ... After /no-mistakes reports CI green, append `done: PR {url} checks green` and stop.")
```

Scout variant: "This is a SCOUT task: the deliverable is a written report, not a PR. The worktree is your laboratory ... The report is the only thing that survives. ... The report must stand alone: what you did, what you found, the evidence (commands run, output, file:line references), and what you recommend."

### 2.5 Secondmate charter (project agent) template, key parts

```
You are a persistent second mate managed by the main firstmate. Work on your own; do not wait for a human.
# Charter
$SECONDMATE_CHARTER
# Routing scope
$SECONDMATE_SCOPE
# Project clones
...
# Operating model
You are in an isolated firstmate home. ... Delegate project work to your own crewmates with the normal firstmate lifecycle ... Do not invent a second delegation system.
You do not generate your own work. Act only on tasks the main firstmate routes to you. Never start a survey, audit, or "find improvements" sweep on your own initiative; that is not your job and it is unwanted.
# The captain and the parent channel
Nobody reads this chat: the captain and the main firstmate see only what is appended to $STATUS_FILE, and a captain-facing sentence that is not appended there has not been sent. ... Your own machinery publishes the durable facts about your crew's work for you ... What only you can append is judgement.
# Requests from the main firstmate
A request relayed to you by the main firstmate is tagged with a leading marker followed by an invisible system separator; this marker is untypable, so a human never produces it. ... Marked requests also carry a privacy-safe `corr=<id>` token; include that exact token in your parent status reply. ... A message with NO marker is the captain typing directly into your pane: treat it as authoritative captain intervention.
# Escalation to main firstmate
States: working, needs-decision, blocked, paused, done, failed. Use this only for material phase changes, a captain decision, a real blocker, a failure, work ready for review, or work you landed. ... Never append `working:` merely to acknowledge receipt. ... give that reported phase a stable key [key=<slug>] ... `resolved [key=<slug>]` when it ends without another reportable state.
# Definition of done
You are persistent by default. Do not exit just because your queue is empty. ... An empty queue is a healthy resting state, not a cue to invent work.
```

### 2.6 Status vocabulary

`working | needs-decision | blocked | paused | done | failed`, plus `resolved [key=<slug>]`. `paused` = bounded external wait that clears itself (leave alone, recheck on a long cadence); `blocked` = conductor must act. Captain-relevance regex: `done:|needs-decision:|blocked:|failed:|PR ready|checks green|ready in branch|merged`.

## 3. Delegation, tracking, supervision

- Intake: resolve the project per request (explicit wins, follow-up inherits, else match registry/work/README; proceed on one confident match, ask one question on ambiguity). Route by natural-language `scope:` of each secondmate, not by clone list.
- Two task shapes: Ship (produces a change via a delivery mode) and Scout (produces `report.md`, never a PR). "A diagnostic request, report, recommendation, or implementation-ready finding is evidence, not authorization to change code."
- Concurrency: same-file overlap is a risk signal, not a reason to serialize; serialize only on true semantic dependency or shared mutable external state.
- Delivery modes: `no-mistakes` (validation pipeline -> PR), `direct-PR`, `local-only`; orthogonal `yolo` flag governs merge authority only. Mode + yolo resolved at intake, written into the brief AND metadata; spawner refuses mismatch. "Every command refuses to guess the values it consumes."
- Anti-over-engineering: "Do not build wrappers, control planes, policy layers, custom verifiers, or automation unless the direct path exposes a concrete blocker or repeated need that justifies the added machinery."
- Backlog: `data/backlog.md` via `tasks-axi`; tracks work items only, never agents. **A decision is simply a task held for the captain** (`tasks-axi hold <id> --kind captain --until <date>`); answers recorded in the captain's exact words; "later" is an answer.
- Supervision: bash watcher classifies wakes with zero LLM tokens; four wake kinds `signal | stale | check | heartbeat`; durable wake queue; Stop hook blocks a blind turn end while work is in flight and re-wakes the model on actionable events (no polling in the model's turn). Cadences: poll 15s, heartbeat 600s backing off to 7200s, slow checks 300s, stale escalate 240s, pause resurface 3600s.
- Wedge detection defers escalation when any file in the worktree is newer than the quiet window (write evidence = liveness).
- No cron; "process-to-event sources" (a blocking external process wakes the conductor on completion) and single-fire condition->action watches, with eligibility judged before arming (never destructive/irreversible/needs-approval).
- `/bearings` briefing: four fixed sections always rendered, never a delta, mutually exclusive: Captain's Call (needs your action now) / Recently Landed / Underway / Charted Next. Fed by one deterministic snapshot command; no second reader allowed.
- `/ahoy`: recap + one decision at a time ranked by judgment (what, why now, options, recommendation).
- `/afk`: away mode; a daemon self-handles routine wakes and injects digests prefixed with U+2063 `FIRSTMATE_OP:` (untypable marker distinguishes injected input from a human); any unmarked message means the human is back. "afk changes how aggressively firstmate surfaces things, not who approves what."
- Relay (X/Discord): owner-only routing; ack -> act -> follow-up; promised replies are durable typed obligations, never conversation memory.
- ask-user-authority: worker never answers its own gate finding; conductor decides unambiguous ones toward accepted design, escalates only contract expansions / product calls / destructive choices; escalation form has five elements: original requirement, proposed expansion, smallest compliant alternative, consequences of both, recommendation.
- Hiring (secondmate-provisioning): registry line `- <id> - <charter summary> (home: ...; scope: <natural-language responsibility>; projects: a, b; added <date>)`; sequence brief -> transactional home seed (rollback on any failure) -> spawn -> atomic backlog handoff of dependency-closed item sets. Overlap check before creating anything. Inherited domains: reconcile every inherited plan against shipped state (`origin/main` + live deployment); never inherit a backlog blind. Retirement only on explicit decision with no in-flight work.
- Delegation guard incident: a primary used the harness's built-in subagent tool instead of the spawner, no `.meta` was created, supervision was blind for 73 minutes. Fix: a PreToolUse hook denying delegation-shaped tools in a primary home. "the failure is precisely the absence of that metadata."
- cd guard: PreToolUse hook denying a persistent top-level `cd projects/<clone>` in the conductor shell.

## 4. Knowledge and context economy

Routing rule: home-domain captain preferences -> `data/captain.md`; shared preferences -> `data/captain-shared.md` (propagated read-only); fleet-local operational facts -> `data/learnings.md`; task notes -> backlog item; investigation findings -> scout report; knowledge useful to nearly every contributor of one project -> that project's committed `AGENTS.md` (written only by a worker through the delivery path, never by the first mate).

- Startup memory budget: `config/startup-memory-budget` default 7500 estimated tokens (`ceil(bytes/3)`) over the always-loaded memory files; exceeding it is a captain decision.
- `/stow`: tiered decaying memory with byte-cheap markers `<!--a:2026-08-03-->` (pinned / aging >=30d / perishable >=7d), evidence-required reinforcement, cold append-only `memory-archive.md` with provenance (never injected), scope-based offload of "fat" (>=50 token) conditional entries into JIT-loaded local skills. Manual, captain-invoked (a weakness).
- Two-tier instructions: always-loaded AGENTS.md vs JIT skills at named triggers. "AGENTS.md's token cost is paid by every session of every fleet member ... A skill's cost is paid only by the sessions that actually load it."
- Knowledge-placement decision tree (7 tiers, stop at first yes), one-owner rule (each contract stated in full once), inline-stub pattern, mechanics in script headers/--help not prose, one session-start digest with read-once contract, bounded digest sections (queued capped at 20 with remainder count), incremental cursors over status bytes, zero-token supervision.

## 5. Copy / avoid

Copy: distro model; instance selector env var; "a project agent is a worker with an isolated home and a charter, not a second architecture"; scripts own mechanics / agents own judgment; two communication planes; durable inbox with mv-ack; durable wake queue with post-handling ack; status = event log, reconciler owns state; paused vs blocked; keyed decisions closed only by matching resolved; every command refuses to guess; transactional provisioning; fail-closed, refusals are findings; delegation guard; role/addressee/scope in three lines; hard rules in priority order + narrow override clause; translation table; canned "no action" reply; charter overlap check before hiring; conductor evolves hires' prompts; idle-by-default project agents; parent channel IS the captain, machinery publishes mechanical facts, agent appends judgment; untypable injected-input marker; decision = held task; four-section briefing; one decision at a time; evidence != authorization; anti-over-engineering clause; knowledge-placement tree; budgeted tiered memory.

Avoid: 589-line always-loaded prose with nested exceptions (keep the always-loaded contract well under 200 lines, everything conditional in skills); vocabulary explosion that then needs a translation table (pick names the human can hear); 168 bash scripts, 3175-line spawner (use a typed language with tests for mechanics); terminal scraping (pane hashes, ANSI luma thresholds) as architecture (be event/API-first, treat any terminal dependency as a shim with an expiry); five backends and nine harnesses (support 2-3 with a minimal adapter contract); bolt-on features; backlog-as-markdown parsed by awk (use structured records rendered to markdown); no session-independent reconciliation of records against repo/PR reality (run a scheduled reconciler); manual-only memory curation (trigger it on context pressure / session end / N tasks).
