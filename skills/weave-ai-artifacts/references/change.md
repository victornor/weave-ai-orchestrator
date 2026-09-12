# Change playbook

AC's own shape for "what did this ticket actually do" — before/after, the files touched, and the
impact. Reach for this on a ticket wrap-up artifact, not a generic "summary" layout; the three
sections below are the ones worth having every time, in this order.

## Technique

**Before / after.** Two `.card`s in a `.row`, labeled `Before` and `After`, each holding either a
short code excerpt (see `references/code.md`'s escaping rule) or a one-paragraph description of the
prior/new behavior. Keep the two cards symmetric — same structure in both, so the reader compares
position-by-position instead of hunting for what changed.

**Files changed.** A `.table` with columns `File`, `Change` (new / modified / removed, as a `.badge`
or plain text — don't invent a fourth verb), and optionally `Why` when the reason isn't obvious from
the filename. Every path is a real `path:line` or `path`, checkable against the repo — never a
paraphrase of a filename.

**Impact.** Short prose, not a list unless there are genuinely several independent effects. State
what actually changes for a user or another system ("the drift test now fails if index.css and the
kit disagree"), not what the code does mechanically — that's already in the diff.

## Worked skeleton

```html
<section class="section">
  <h2>Before / after</h2>
  <div class="row" style="gap: var(--space-6);">
    <div class="card">
      <strong>Before</strong>
      <p class="prose">No shared CSS source; an artifact would have had to hand-copy colors.</p>
    </div>
    <div class="card">
      <strong>After</strong>
      <p class="prose"><code>weave_artifact_kit()</code> returns the same tokens <code>index.css</code> defines, drift-tested.</p>
    </div>
  </div>
</section>

<section class="section">
  <h2>Files changed</h2>
  <table class="table">
    <thead><tr><th>File</th><th>Change</th></tr></thead>
    <tbody>
      <tr><td><code>packages/core/src/artifacts/kit.ts</code></td><td>new</td></tr>
      <tr><td><code>packages/server/src/tools.ts</code></td><td>modified — new ToolDef</td></tr>
    </tbody>
  </table>
</section>

<section class="section">
  <h2>Impact</h2>
  <p class="prose">An agent can now fetch a drift-checked CSS kit and the artifact playbooks in one tool call, instead of guessing at AC's visual language.</p>
</section>
```
