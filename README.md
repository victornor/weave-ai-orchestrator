# OpenConductor

Workspace-level coordination of AI coding agents across multiple git projects. A workspace is a virtual business: one **conductor** agent the human talks to, hired **roles** per project, and disposable **workers** spawned from a role for each ticket (running on Claude Code, Codex, OpenCode, Gemini CLI) that never leave their project, work in their own worktree with one session per ticket, and follow OpenSpec's propose → approve → apply → archive flow.

Status: planning. Start with [`docs/PLAN.md`](docs/PLAN.md).

- `docs/PLAN.md` — the implementation plan (decisions, domain model, interfaces, milestones).
- `docs/design/DESIGN-CONTRACT.md` — tokens, components, screens and decisions transcribed from the accepted mockup (`docs/design/mockup/`).
- `docs/design/claude-design-prompt.md` — the briefs that produced the mockup.
- `docs/SCENARIOS.md` — end-to-end walkthroughs (create workspace, add project, ship a feature, cross-project work, curation, Hyprland surface).
- `docs/prompts/` — draft conductor prompt, worker instruction template (role charter + brief), skill outlines.
- `docs/research/` — what was taken from firstmate, paperclip, Synapse and OpenSpec, with verbatim references.
