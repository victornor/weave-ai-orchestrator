## 1. launch.test.ts controls its environment

- [x] 1.1 Replace every ambient `process.env` comparison in `packages/runtime-sdk/src/launch.test.ts` with stubbed daemon env (`vi.stubEnv`) and concrete expected values; explicitly unset `MISE_*` in the redirected-HOME tests. Verify: the file is green twice — once with `MISE_DATA_DIR/MISE_CONFIG_DIR/MISE_CACHE_DIR` set to garbage values, once with `env -u` of all three.

- [x] 1.2 Add the worker-case precedence test: redirected HOME/XDG + daemon-owned `MISE_*` ⇒ the daemon's roots win over the derived ones (overlay-explicit still beats the daemon's, existing test). Verify: included in both green runs from 1.1.

## 2. Sweep the suite for the same shape

- [x] 2.1 Inventory candidates across `packages/**/*.test.ts(x)`: reads of `process.env`, `homedir()`, and host-path literals (`.claude`, `.local/share`, mise/config paths, `current` symlink). Record the hit list with file:line.

- [x] 2.2 Disposition every hit: fix in-test (same stub pattern) where the test asserts ambient state or a real host path; clear the rest with a written reason in the PR description. Suspected product defects are reported on the ticket, not fixed here. Verify: the PR carries the complete named list, no hit left undispositioned.

## 3. Verification and delivery

- [x] 3.1 `pnpm lint && pnpm typecheck` green from this worker environment.

- [x] 3.2 Full `pnpm test` green in this worker environment (`MISE_*` set as found), with both suite blocks pasted verbatim (core/server totals and UI totals, real numbers, never summed).

- [x] 3.3 Commit with the ticket id, deliver per delivery.md (push branch, open PR), transition to `in_review`.
