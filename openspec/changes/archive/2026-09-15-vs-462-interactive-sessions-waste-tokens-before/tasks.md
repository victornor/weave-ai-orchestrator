# Tasks

- [x] 1. Cheap opening turn: narrow the interactive first-turn tool list to the ticket-read and comment tools, enforce it on every runtime (MCP run-token scoping plus the opencode adapter's native-tool switch), and make the prompt match.
- [x] 2. Batch tool calls: add the one-step-for-independent-reads rule to the worker brief, the worker `AGENTS.md` and the `weave-ai-worker` skill.
- [x] 3. Show cache misses: record each run's first request fresh-versus-cached split, expose it in `weave_run_inspect` and on the V2 run page, and flag a first request over 50k uncached.
- [x] 4. Tests: the opening turn's tool list is restricted; the prompt text matches; the first-request split is parsed from opencode and Claude usage events.
- [ ] 5. Evidence: a scratch-daemon interactive session on a small ticket, reporting the opening turn's steps and fresh tokens before and after. Unticked: the credential rule forbids a live coding CLI against the daemon's credentials and an isolated scratch daemon has none; the daemon's structural proof is in task 4's tests and a live before/after needs the owner to run one session.