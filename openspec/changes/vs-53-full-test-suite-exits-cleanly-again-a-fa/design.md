# Design

## Context

`runAdd` is the whole project-add pipeline and it has exactly three callers:

| Caller | Awaits it? | What a rejection means there |
|---|---|---|
| `add` | yes | the caller asked for the blocking form and wants the error |
| `startAdd` | no | the answer already went out; the job is the record |
| `retryAdd` | no | same |

`runAdd`'s `catch` block writes `status: 'error'` and the error text to the project row, fails the
job at the sub-step it reached, logs at warn, and re-throws. Everything an observer needs is already
durable **before** the re-throw. The re-throw exists only for `add`.

## Decision: absorb at the call site, do not stop re-throwing

Two shapes were available:

1. **`runAdd` stops re-throwing.** Then `add` — which awaits it and whose contract is
   `Promise<Project>` that rejects on a failed add, asserted by `projects.test.ts:87` and relied on
   by the `POST /projects` route — would resolve with a project row in `error`. That is a behaviour
   change in the blocking path, to fix a bug in the detached one.
2. **Handle the promise at the two detached call sites.** `add` is untouched; the detached callers
   say, once, that they do not want the re-throw. This is what the ticket's acceptance criteria name
   first, and it is what this change does.

A one-line `.catch(...)` at each call site would do, but a named `detach(slug, p)` keeps the reason
in one place, gives both sites the same log line, and is the obvious hook if a third detached caller
appears.

Unlike VS-44's `schedule`, `detach` needs no `try`/`catch` around the call: `runAdd` is an `async`
function, so a synchronous throw inside it is already a rejection of the promise it returns, and
`createRow` — the part that really can throw synchronously — runs before it and outside it, in the
caller, where it is meant to throw.

## Decision: no drain at shutdown

Covered in the proposal: an add is minutes long, so awaiting one at shutdown would hang the daemon,
and `setup-jobs` already requires a job left `running` by a stopped daemon to be settled at the next
startup and its project left retryable. Containment without a drain is the whole fix.

## Testing

Asserting "no unhandled rejection" from inside the test that causes it needs a listener, because
vitest reports the escape after the test file has finished:

```ts
const escaped: unknown[] = [];
process.on('unhandledRejection', (r) => escaped.push(r));
// … drive the failing add, wait for the job to settle …
await new Promise((r) => setImmediate(r));   // twice: Node reports at the end of the turn
expect(escaped).toEqual([]);
```

The listener is removed in a `finally`, so it cannot swallow an escape from a later test. The test
was confirmed to fail (`expected [ …(1) ] to deeply equal []`) with the fix reverted.
