# ADR 0003 — SSE without a cursor tails; with a cursor replays

Date: 2026-09-04 · Status: accepted

## Context
`GET /api/w/:ws/events` replayed the whole outbox when a client connected without `after`. Long-lived clients (the presenter) then re-processed historical `worker.spawned` events and created windows for retired workers.

## Decision
No `after` and no `Last-Event-ID` → start at the current last sequence (live tail only). A cursor → replay from it. Consumers treat events as nudges and re-read the daemon's authoritative state (the presenter re-fetches `/presenter/desired`; the web app invalidates queries).
