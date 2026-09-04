# ADR 0004 — Auto-merge is advanced by a sweep, not by the in_review transition alone

Date: 2026-09-04 · Status: accepted

## Context
A ticket with `auto_merge` on reached `in_review` and stayed there: no approval was required, but nothing moved it to `merging`.

## Decision
`TicketsService.autoMergeSweep()` moves `in_review` + `auto_merge` tickets to `merging` when their delivery is ready: immediately for `local-branch`, and for `pr` when the project's `requireCi` is false or the forge reports CI green (pending waits, failure comments on the ticket). The sweep runs from the supervisor tick and is also scheduled right after an `in_review` transition, so it also covers daemon restarts.
