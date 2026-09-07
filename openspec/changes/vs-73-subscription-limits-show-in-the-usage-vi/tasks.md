## 1. One launcher for every spawn of a coding CLI

- [x] 1.1 `launchCommand()` in `runtime-sdk`: the child's environment is the daemon's own with the adapter's overlay on top, and the command is resolved on the effective PATH, then in the directories the usual per-user installers use, and returned as an absolute path.
- [x] 1.2 A command that already carries a path is used as given; one that is found nowhere is returned unchanged so the spawn fails with the runtime's own error.
- [x] 1.3 The claude turn path and the claude account probe both launch through it.

## 2. Make a failed probe legible

- [x] 2.1 A failed description carries the resolved command, the cwd and the searched locations; the daemon logs them with the reason when a refresh produces an account it could not describe, and stores neither.
- [x] 2.2 The limits view model separates a probe that failed from an account that reports no windows, and both the web usage view and `conductor usage` say which it was, with the note and the capture time.
- [x] 2.3 Both surfaces state that a window mixing subscription with metered or unclassified usage is why the cost is still shown.

## 3. Cover it

- [x] 3.1 Launcher tests: PATH resolution, installer-directory fallback, PATH winning over it, a path-carrying command, an unresolved command, and the environment merge.
- [x] 3.2 A probe test that runs with an empty PATH against a fake CLI installed where an installer puts it, proving resolution does not depend on the parent shell.
- [x] 3.3 Render and web tests for the failed-probe line and the mixed-billing line.
- [x] 3.4 `pnpm lint`, `pnpm typecheck` and `pnpm test` green.
