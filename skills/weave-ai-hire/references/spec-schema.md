# Role spec — fields

Passed to `weave_role_hire(spec)`. The daemon validates it (`RoleSpecSchema`) and rejects anything malformed with the field names.

| Field | Type | Notes |
|---|---|---|
| `id` | kebab-case slug | Stable and readable: `api-backend`, `dash-frontend`. Never a ULID, never a person's name. |
| `name` | string | What a human calls the job: "Backend Engineer". |
| `project` | project slug | Exactly one. A role belongs to one project, always. |
| `title` | string, optional | A longer label for the UI. |
| `icon` | string, optional | One emoji, for the UI. |
| `charterSummary` | one sentence | What this role owns. Goes at the top of `CHARTER.md`. |
| `scope` | natural language | **Routing matches on this.** In-scope and out-of-scope, both stated. |
| `responsibilities` | string[] | 5–9 concrete deliverables. |
| `capabilities` | string[] | Stack and tooling: `node`, `postgres`, `drizzle`, `vitest`. |
| `exclusions` | string[] | What this role does not do, even when it could. |
| `rules` | string[] | Project-specific rules, lifted from that project's `PROJECT.md`. |
| `sessionPolicy` | `per_ticket` \| `fresh` \| `persistent` | `per_ticket` for builders, `fresh` for reviewers. |
| `maxWorkers` | 1–32 | Stored on the role (default 2). Not a spawn cap — the project's Settings max-workers is. |
| `permission` | `{mode, allowed[], denied[]}` | `mode`: `auto` \| `restricted` \| `bypass`. `bypass` needs the human's explicit opt-in — never propose it yourself. |
| `secrets` | string[] | Names of workspace secrets exposed as env. Names only; never a value, ever. |
| `notes` | string, optional | The weaver's notes, rendered at the end of the charter. Where refinements land. |
| `createdBy` | `human` \| `weaver` | `weaver` when you hire. |

## What makes a scope good

It answers "does this ticket belong to this role?" for a ticket nobody has written yet.

**Bad:** "Works on the API." — matches everything and nothing.
**Bad:** "Owns `src/api/handlers/*.ts`." — a path list is not a scope; it rots on the first refactor.
**Good:** "Backend and API work in the `api` repo: HTTP handlers, service logic, the data model and its migrations, and the tests for all of it. Not the frontend, not deployment or infrastructure, not the shared design system."

Write it so a *worker* reading it knows when to stop, and so *you* reading it know where to route.
