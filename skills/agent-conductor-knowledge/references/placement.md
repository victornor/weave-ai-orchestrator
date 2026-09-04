# Placement — worked examples

| The fact | Where it goes | Why |
|---|---|---|
| "The retry helper double-counts attempts on conflict" | the ticket (or a fix) | task state and a defect, not knowledge |
| "Run `pnpm dev --filter api` to start just the API" | `PROJECT.md` → Stack & commands | how to work on this project, and the repo README does not say it |
| "The README says `npm run dev`; that is stale, it is pnpm now" | the **repo**, via a PR | any contributor needs it; fix it at the source, then it is not knowledge |
| "`src/generated/**` is regenerated; edits are lost" | `PROJECT.md` → Landmines | it bites, and nothing in the repo warns you |
| "Integration tests need a CREATEDB-capable role" | `PROJECT.md` → Landmines | hard-won, not derivable, will bite the next worker |
| "This quarter we are moving the dashboard off the legacy API" | `PROJECT.md` → Current focus | conductor and human maintain it; workers read it |
| "Commit messages are conventional commits" | `SHARED.md` → Conventions | true across projects, names none of them |
| "The human wants PR links, never PR numbers" | `WORKSPACE.md` → People & preferences | about the human, and workers must not see it |
| "Acme's contract renews in March" | `WORKSPACE.md` → Business | business context; conductor only |
| "Approved: no auto-merge on the dashboard, ever" | `decisions.md` (via the decision) + `WORKSPACE.md` → Policies | a durable decision that became policy |
| "The API is at `~/git/api`" | nowhere | derivable, and it will be wrong on the next machine |
| "Postgres 16, Node 22" | the **repo** (`.nvmrc`, compose file) | already declared in the repo; a copy here rots |
| "Fixed the flaky test in ACME-42" | the ticket | it is history, and git has it |

## Entries that should never exist

- Anything containing a token, a password, a private URL or a customer's data.
- Anything you could get from `git log`, `git blame`, the file tree, or the specs.
- Anything that will be false in a month with no marker (`<!--exp:YYYY-MM-DD-->` fixes this).
- A restatement of the repo's own documentation. Point at it instead.
- A note about how you personally approached the ticket. Nobody after you is you.
- In `SHARED.md`: any project name, repo name, client name or role name. That file must teach a worker nothing about the portfolio.
