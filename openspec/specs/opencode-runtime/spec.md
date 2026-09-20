# opencode-runtime Specification

## Purpose
A running worker page sits on "working" between steps. Captain (2026-09-19) watched an opencode worker do a tool call every ~7 s and saw nothing move; in a second case, a 5-minute, 50-tool-call turn that never narrated left the page looking dead ("no response from the agent"). The worker was healthy both times. The page had nothing true to show.
## Requirements

### Requirement: An opencode turn is driven through a per-turn server
The OpenCode adapter SHALL run a turn by starting `opencode serve` on a loopback port under the same containment, environment and working directory as today, sending the prompt to the session, and reading the server's event stream for that session. It SHALL translate `message.part.delta` and `message.part.updated` into partials and the existing normalized events, keep session resume by session id, cancel by aborting the session and then terminating the server, classify errors as today (`incomplete_turn`, `provider_error`), and report usage and cost from the completed assistant message. If the server cannot start or its event stream cannot be read, the adapter SHALL fall back to `opencode run --format json` for that turn and the run SHALL complete as it does today.

#### Scenario: Tool starts before it finishes
- **WHEN** the server reports a bash tool part with status `running`
- **THEN** the adapter emits `tool.call` with the command at that moment and `tool.result` when the part completes

#### Scenario: Server cannot start
- **WHEN** `opencode serve` exits before reporting a listen address
- **THEN** the turn runs through `opencode run --format json` and completes normally, with no partials
