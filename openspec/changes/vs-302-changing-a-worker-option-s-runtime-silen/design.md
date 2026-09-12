## Context

See `proposal.md` — Why. The defect is one `onChange` in `WorkerOptionRow`
(`packages/ui/src/routes/Settings.tsx:1041`): it calls
`patch({ id, description, runtime, model })`, rebuilding the option from four named fields. The
catalog type carries an optional `effort`, the schema accepts its absence, and the row does not
display it, so the loss is invisible. The row's other controls already spread the option
(`{ ...option, … }`), so the runtime select is the sole path that reconstructs it.

## Goals / Non-Goals

**Goals:**
- A change to an existing option's runtime preserves every field the runtime control does not
  itself edit, `effort` included.
- A regression test that fails against today's code.

**Non-Goals:**
- Making `effort` editable on the row, or changing what a runtime change means for `model`.
- The description edit (VS-299) or any other catalog behaviour.

## Decisions

**Spread the option rather than add `effort` to the named list.** Adding `effort` to the literal
would fix today's symptom but leave the same trap for the next field added to the catalog. Spreading
`{ ...option, runtime, model }` makes the default correct — a field survives unless the control
explicitly overwrites it — and matches what the model, free-text and thinking-level controls already
do. The alternative (a helper that merges known fields) was rejected as more surface for no gain.

**Keep `model` explicitly overwritten.** The runtime change must still clear the model when the
runtime is cleared (`runtime == null ? null : option.model`), matching the existing behaviour and
`model-selection/unconfigured-option`; spreading alone would leave a stale model on an unset runtime.
This is the one field the runtime control does deliberately edit.

**Regression test asserts the saved value, not the call.** The test seeds an option with
`effort: 'high'`, changes its runtime, and asserts `state.saved`'s resulting `workerOptions` still
carries that effort — the value the write produces, not that an `onChange` fired.

## Risks / Trade-offs

- [A runtime change may make the stored `effort` invalid for the new runtime's model] → Out of scope:
  the runtime control never edited effort and the acceptance criterion is preservation. Making it
  clear-on-invalid is a separate behaviour question and is not asked for here.
- [VS-299 is editing the same component] → Keep the diff to the runtime `onChange`; rebase onto
  whatever landed.
