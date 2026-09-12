# `ee/` — commercially licensed code

Everything in this directory and every subdirectory of it is **not** covered by the
AGPL-3.0 licence in the repository root. It is licensed under the Weave AI
Commercial Licence in [`ee/LICENSE`](./LICENSE).

In short:

- You may **read, copy, build, run and modify** this code for development, evaluation,
  testing, security review and contributing back. That is free and needs no key.
- **Production use requires a valid licence key** — running it for a business, for an
  organisation, for a third party, or as part of a hosted service.
- You may not remove or work around the licence-key check, and you may not redistribute
  this code or offer it as a service.

Everything outside `ee/` is AGPL-3.0 and always will be. Nothing in the AGPL core depends
on anything in here: with `ee/` deleted the daemon, the CLI and the web app still build and
run, with the paid features simply absent.

## What belongs here

Paid, in-daemon features — team and multi-user workspaces, SSO/SCIM, the audit log — and
nothing else. A feature that the single-user open core needs to work belongs outside `ee/`.

## Conventions

- Packages under `ee/` set `"license": "SEE LICENSE IN ee/LICENSE"` in their `package.json`,
  not `AGPL-3.0-only`.
- Contributions here are accepted under the same CLA as the rest of the repository
  ([`CLA.md`](../CLA.md)). Contributing grants you no production-use rights.

Nothing lives here yet — this directory exists to fix the convention before the first paid
feature lands.
