# Plan playbook

For a sequence of steps or phases a human needs to follow or approve — a migration plan, a rollout
sequence, an incident timeline. The value here is ordering and dependency, not detail per step: a
plan artifact that reads like a wall of paragraphs has lost the thing that made it worth making as
an artifact instead of a comment.

## Technique

- **A sequence you do once, in order:** `<ol class="steps">`. One `<li>` per step, a short bold lead
  ("Cut the release branch") followed by one sentence of detail at most. If a step needs three
  sentences, either the step is really two steps, or the detail belongs in a linked ticket, not
  inline.
- **A sequence with a "when" attached to each entry** (an incident timeline, a rollout with dates):
  `<ul class="timeline">`. Each `<li>` leads with the timestamp or phase name, bold, then what
  happened.
- Group steps into `.section`s with an `h2` when the plan has real phases ("Before the freeze" /
  "During the freeze" / "After") — don't flatten a three-phase plan into one dozen-item list.
- Mark a step's state, if relevant, with a `.badge` or a `.status-*` color (done / blocked /
  pending) rather than a parenthetical.

## Worked skeleton

```html
<section class="section">
  <h2>Rollout</h2>
  <ol class="steps">
    <li><strong>Freeze merges</strong> — 2026-09-12, mobile team cuts its release branch.</li>
    <li><strong>Run the migration</strong> — <code>pnpm --filter @weave-ai/db migrate</code> against staging first.</li>
    <li><strong>Verify</strong> — <code>pnpm test</code> green, then a manual smoke pass on staging.</li>
    <li><strong>Deploy</strong> — <span class="badge status-idle status-dot">pending</span> cut a release, run <code>weave daemon upgrade</code>.</li>
  </ol>
</section>
```
