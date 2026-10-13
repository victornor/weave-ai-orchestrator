## 1. CI off the self-hosted runner

- [x] 1.1 Switch every `ci.yml` job to `ubuntu-latest`; remove `VITEST_MAX_FORKS` and the runner comments; confirm no `self-hosted` remains in `.github/workflows/`
- [x] 1.2 Remove the self-hosted runner instructions and §9 from `README.md` and `docs/OPERATIONS.md` (fix links to §9)

## 2. Dependencies

- [x] 2.1 Bump `proxy-addr`, `@modelcontextprotocol/sdk`, `sharp`, `hono`, `fast-uri`, `ip-address`; keep the lockfile consistent
- [x] 2.2 Upgrade `selfsigned` to a node-forge-free release and adapt the self-signed TLS mode and its test
- [x] 2.3 Run `pnpm audit --prod`; list anything remaining with reasons for the PR

## 3. Setup route and loopback trust

- [x] 3.1 Reproduce the three exposures on a scratch daemon (scratch config dir, ephemeral port) and record the output
- [x] 3.2 Proxy-aware loopback test; restrict `/api/auth/setup` to loopback clients; tests including the quickstart path
- [x] 3.3 Ignore `loopbackTrusted` on non-loopback binds with a startup warning; tests
- [x] 3.4 Add warnings to `docs/DOCKER.md` and `docs/OPERATIONS.md`

## 4. Workflow hardening

- [x] 4.1 Pin all actions in `ci.yml` and `publish-plugin-sdk.yml` to SHAs with tag comments; per-job permissions only where needed
- [x] 4.2 Add `.github/dependabot.yml` for `github-actions` and `npm`

## 5. Verify

- [x] 5.1 Lint, typecheck, both suites green with counts pasted; PR notes captain removes the runner in Actions settings after publishing (PR CI on hosted runners runs when the draft is marked ready, at landing)
