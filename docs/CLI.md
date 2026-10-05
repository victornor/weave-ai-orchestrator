# Command cheat-sheet

Run `weave <group> --help` for the full set. Global flags: `-w/--workspace`, `--json`, `--no-color`,
`--context`, `--url`, `--token` (env: `AC_WORKSPACE`, `AC_API_URL`, `AC_TOKEN`).

## Daemon and access

`weave daemon update apply` asks the running daemon to upgrade itself: it holds dispatch, waits for
every running turn to finish, then builds, backs up, switches `current` and restarts. The web app offers
the same thing under Settings → Updates. `weave daemon upgrade` is the from-this-shell path that
still works when the daemon is not answering; `releases` and `rollback` go with it (see docs/OPERATIONS.md §6).

| Command | Does |
|---|---|
| `weave daemon start [-f] [--listen host:port]` | start the daemon on this machine (`--listen` overrides `http.listen` in `daemon.yaml` for this start) |
| `weave daemon stop \| status \| logs [-f] [-n N]` | lifecycle and the local log |
| `weave daemon set-password [-u operator]` | first-run operator setup, or change the password |
| `weave daemon install-service [--print] [--launchd]` | write `~/.config/systemd/user/weave-ai.service`, or with `--launchd` a macOS LaunchAgent plist (printed on any other platform) |
| `weave daemon update` | running version and commit, the source at its ref, and whether an update is available |
| `weave daemon update apply [--ref R] [--test] [--no-follow]` | queue an upgrade on the daemon; it starts only once no turn is running, and is followed to its outcome |
| `weave daemon update cancel` | cancel a queued or waiting upgrade and resume dispatch |
| `weave login <url> [--pin] [--insecure] [--device N] [--name N]` | sign in, store a context |
| `weave logout [--all] [--forget]` · `weave context list\|use\|remove\|show` | sessions and contexts |
| `weave devices list \| revoke <id> \| revoke --all` | sessions signed in to the daemon |
| `weave doctor` | daemon, runtimes, node, git, gh, workspaces — with the fix for each failure |

## Workspace, projects, runtimes

| Command | Does |
|---|---|
| `weave init <dir> --prefix ACME [--id] [--name] [--local]` | scaffold and register a workspace |
| `weave workspace list \| use <id> \| register <path> \| unregister <id>` | the daemon's workspace registry |
| `weave workspace set-default <key=value...>` | change workspace defaults, e.g. `knowledgeBudgetTokens.project=20000` |
| `weave workspace pause \| resume` | stop and restart run dispatch for the workspace |
| `weave workspace export [--out <dir>]` | portable package on the daemon host: `workspace.yaml`, roles, knowledge, tickets as markdown — no db, no runs, no secrets |
| `weave workspace import <dir> --target <dir>` | copy an export into a new or existing workspace directory and register it; tickets land in `backlog` with an `[imported]` comment |
| `weave project add <git-url> [--id] [--branch] [--max-workers N] [--setup CMD] [--no-follow]` | clone, `openspec init`, seed the KB, create the scout ticket — each sub-step and its output stream to the terminal as it runs |
| `weave project retry <id> [--no-follow]` | re-run an add that failed, reusing whatever is already on disk |
| `weave project list \| show <id> \| remove <id> \| fetch [id]` | projects; `fetch` fast-forwards the primary clone |
| `weave project set-policy <id> <key>=<value>...` | per-project policies (`deliveryMode`, `mergeMethod`, `requireCi`, …) |
| `weave project set-landing-branch <id> [branch] \| --clear` | set, change or clear the branch tickets' work is expected to reach, after the project was added |
| `weave project set-openspec <id> on\|off` | turn a project's OpenSpec mode on or off after it was added; tickets already bound to a change keep their flow (VS-578) |
| `weave project set-policy <id> deleteBranchAfterMerge=true\|false` | delete a ticket's remote branch after its pull request merges; on by default (VS-770) |
| `weave project prune-branches <id> [--dry-run]` | delete the leftover branches of done or cancelled tickets whose work landed (VS-770) |
| `weave project set-policy <id> visualPlanArtifact=true\|false` | experimental, off by default: require a visual artifact with every change plan, shown on its approval card (VS-624) |
| `weave runtime list \| detect \| models <id> \| login <id> [--print]` | coding CLIs and their auth |

## Talking and deciding

| Command | Does |
|---|---|
| `weave say "<text>" [--timeout 180] [--no-wait]` | one-shot message to the weaver; prints the reply |
| `weave chat [ticketId]` | interactive thread; with a ticket it binds to that ticket's worker |
| `weave attach <workerId\|weaver>` | live transcript + steering for one agent |
| `weave top` | one-screen fleet view |
| `weave briefing` | the four-section briefing, rendered from the snapshot (no LLM tokens) |
| `weave decision list [-s open] [--owner human]` | everything waiting on you |
| `weave decision show <id>` · `weave decision answer <id> <key\|N\|text> [--text] [--remember] [--yes]` | answer a decision card |
| `weave decision withdraw <id>` | withdraw one |

## Roles, workers, tickets

| Command | Does |
|---|---|
| `weave role list [-p project] \| show <id>` | roles and their live workers |
| `weave role activate <id> [--runtime] [--model]` | activate a hired role so it picks up tickets |
| `weave role set-max-workers <id> <n>` | change how many workers a role runs at once (1-32; the project limit still applies) |
| `weave role pause \| resume \| retire <id>` · `weave role charter show \| rollback <id> <rev>` | role lifecycle and charter revisions |
| `weave worker list [-p] [-r] [-s] [--all]` · `weave worker show <id>` · `weave worker brief <id>` | live workers |
| `weave worker message <id> <text>` | direct message to a worker (wakes it) |
| `weave worker pause \| resume \| cancel \| relaunch \| purge <id>` | worker lifecycle |
| `weave worker handover <id>` · `weave worker handback <id> --note <note>` | take a worker's session for your own terminal, or give it back (VS-249) |
| `weave ticket create <title...> [-p] [-k kind] [--priority] [-d desc] [--assign role] [--auto-merge] [--parent] [--blocked-by]` | create a ticket |
| `weave ticket list [-p] [-s] [-k] [-r] [--search] [--limit]` · `weave ticket show <id>` | the board in the terminal |
| `weave ticket merge-queue [-p <project>]` | who is landing now and who is waiting behind them |
| `weave ticket assign <id> <roleId>` · `weave ticket set <id> [--title] [--priority] [--auto-merge]` | edit |
| `weave ticket transition <id> <status> [--note] [--blocked-by]` | move through the state machine |
| `weave ticket comment <id> <body...>` · `weave ticket comments <id>` | talk to the live worker on its ticket |
| `weave ticket cancel <id>` · `weave ticket discard <id> --force` | cancel; discard needs an approved decision |
| `weave ticket open <id> [--pr] [--print]` | open the ticket or its PR in a browser |

## Watching, knowledge, specs, cost

| Command | Does |
|---|---|
| `weave runs list [-a] [-t] [-s] [--limit]` · `weave runs show <id> [--raw]` · `weave runs tail <id>` · `weave runs cancel <id> [--mode kill]` | the run log |
| `weave usage [--scope workspace\|project:<id>\|role:<id>\|worker:<id>\|ticket:<id>\|model:<id>] [--window 24h\|today\|7d\|week\|month\|all] [--grain hour\|day\|week] [--by model\|ticket\|role\|worker\|project] [--series] [--sync [--runtime <id>]]` | tokens and cost; `--sync` probes the plan limits now |
| `weave knowledge lint` | sizes, budgets, curation state for every KB |
| `weave knowledge show \| edit \| note \| revisions \| revert \| curate <scope> [-p project]` | scopes: `workspace`, `shared`, `decisions`, `project` |
| `weave specs list \| show <capability> \| changes [name] \| search <q> \| explore [project]` | the spec index |
| `weave worktree list \| verify <id> \| discard <id> [--force]` | worktrees and landed-work verdicts |
| `weave weaver show \| reset-session` | the weave agent |
| `weave models` · `weave models set conductor\|weaver\|workers --runtime <id> --model <id\|default> [--effort <e>]` · `weave models inherit conductor\|weaver\|workers\|options` · `weave models options add\|set\|remove` | the workspace's two model settings and the worker-options catalog; each control writes on its own, inherit clears one |
| `weave presentation status \| set <path> <value> \| reconcile \| open` | where agents are shown |
| `weave presenter [--surface tmux\|hyprland\|herdr\|headless] [--once]` | run this on the machine you look at |

`weave agent inbox|report|ask|human` exists for agents inside a run (needs `AC_RUN_TOKEN`); humans
never call it.
