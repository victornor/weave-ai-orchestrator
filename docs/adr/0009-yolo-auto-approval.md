# ADR 0009 — YOLO mode answers the approval decision instead of skipping it

Date: 2026-09-05 · Status: accepted

## Context
Every `change` ticket stops twice for a human click: `plan_approval` when the plan validates, `merge_approval` when the worker delivers. On 2026-09-05 four PRs sat waiting for approval at once and approval, not worker capacity, was the workspace's throughput limit.

Two escapes already existed, and both are silent. `proposalApproval: 'none'` makes `proposed` recurse straight into `approved` with **no `decisions` row at all**; a ticket's `auto_merge` flag suppresses the `merge_approval` entirely and lets `autoMergeSweep` (ADR 0004) transition the ticket itself. Neither leaves any record that the work was approved, and neither is a mode that can be turned on for a whole workspace and seen.

PLAN §15 stated the ownership policy as `merge_approval: human` — "not overridable; only a ticket's `auto_merge` flag bypasses it". This ADR records the deviation: it is now overridable, at workspace level with a per-project override.

## Decision
`defaults.yolo` in `workspace.yaml`, with `policies.yolo` overriding it per project in either direction (absent inherits). When it is on for a ticket, the daemon **raises the approval decision exactly as it always does and then answers it** `approve` as the `system` actor, with answer text naming the mode.

Timing differs by kind because readiness does. A plan is ready the moment the decision exists — `validateForProposed` has already run — so it is answered inline in the `proposed` transition. A merge is not, so the decision is created and left open and `autoMergeSweep`, which already knows how to wait for a green PR, answers it. The sweep's candidate set widens from `auto_merge = 1` to that or a YOLO project; its CI gate is unchanged; it branches once at the end — answer an open decision if there is one, otherwise transition directly, which is `auto_merge`'s existing path untouched.

The alternative was to extend the two existing short-circuits to cover YOLO. That is a smaller diff and was rejected: it would have made the throughput win cost the audit trail, which is the opposite of what a mode this consequential needs. Answering the real decision costs one row per approval and keeps supersession, the asker wake, the knowledge append and the history for free.

The setting is read at the moment the approval would be granted rather than stamped on the decision, so no new column is needed, turning the mode off stops every auto-approval that has not happened yet, and turning it on picks up approvals already waiting. Decisions already answered are never reverted.

## Consequences
- `plan_approval` and `merge_approval` only. `hire_approval`, `discard_approval`, `retry_approval`, `gate_finding` and questions keep their owners.
- Nothing is bypassed: CI, the merge queue (§11.4) and the landing verification are on the far side of the same transition a human approval triggers.
- Precedence is unchanged. `proposalApproval: 'none'` is still checked first and still wins; `auto_merge` still suppresses the merge decision. YOLO decides what happens to a decision that *is* raised.
- The web app carries a persistent indicator while the mode is on, and no surface offers an approve action for a decision the daemon will grant. The conductor instructions and worker briefs state the policy so no agent waits on a human who will never be asked.
- The sweep now evaluates every `in_review` ticket in a YOLO workspace rather than only `auto_merge` ones. Same cost profile as an `auto_merge`-heavy workspace; only tickets with a PR reach the forge.
