## Why

VS-796's audit of the repository before it goes public found four code-level blockers: pull-request CI runs fork-controllable code on a persistent self-hosted runner; production dependencies carry known advisories (1 critical, 3 high); the first-time operator setup route is open to any network peer in two configurations; and workflow actions are referenced by mutable tags. None is a leaked secret, but each one is the first thing a public visitor or attacker would find.

## What Changes

- **CI**: every job in `.github/workflows/ci.yml` runs on `ubuntu-latest`; the runner-only `VITEST_MAX_FORKS` tuning goes. Check names stay `lint`, `typecheck`, `test-core`, `test-ui`. No `self-hosted` label remains in any workflow. README and `docs/OPERATIONS.md` drop the self-hosted-runner instructions and the §9 host layout and firewall rules.
- **Dependencies**: bump `proxy-addr`, `@modelcontextprotocol/sdk`, `sharp`, `hono`, `fast-uri`, `ip-address` to patched versions (direct upgrade or `pnpm.overrides`). Replace `selfsigned` 2.x (which pulls the unpatched `node-forge`) with a release that does not depend on it, adapting the self-signed TLS mode. Anything left in `pnpm audit --prod` is explained in the PR.
- **Setup route and loopback trust**: reproduce each exposure on a scratch daemon, then fix: `POST /api/auth/setup` accepts only a loopback peer; `auth.loopbackTrusted` is ignored (with a startup warning) for a non-loopback bind; the peer address honours `http.trustProxy` so a same-host proxy cannot make remote clients look loopback. Quickstart (loopback bind) keeps working. Docs in `DOCKER.md` and `OPERATIONS.md` get warnings.
- **Workflow hardening**: pin every `uses:` to a commit SHA with the tag in a comment; add `.github/dependabot.yml` (`github-actions`, `npm`); keep `permissions: contents: read`. `publish-plugin-sdk.yml` changes only by SHA pinning.

## Non-goals

Docs/community files/scrubbing (separate ticket); history or PR-text cleanup; repository settings and removing the runner registration (captain does that after publishing).

## Impact

`.github/`, `docs/OPERATIONS.md`, `README.md`, `docs/DOCKER.md`, `package.json`/lockfile, `packages/server/{package.json,src/auth.ts,src/routes/auth.ts,src/daemon.ts}`, their tests.
