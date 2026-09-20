## Context

See `proposal.md` — Why. The current code:

- `useRoleChatOpen(ws)` in `packages/ui/src/v2/roleChat.tsx` wraps `usePersistentSession(ws)` and
  navigates from a callback passed to `mutate(vars, { onSuccess })`.
- `RoleChatRow`'s click handler calls `onNavigate?.()` **before** `chat.open(role)`. In the phone
  **More** sheet `onNavigate` is `setMoreOpen(false)`, so the row is unmounted while the open request
  is in flight.
- `@tanstack/query-core@5.102.8`'s `MutationObserver.#notify` only invokes the per-call
  `onSuccess`/`onError`/`onSettled` while `this.hasListeners()`; unmounting removes the observer, so
  the navigation callback is dropped. The hook-level `onSuccess` in `useMutation` options runs in
  `Mutation.execute` regardless of observers.

The existing tests hide this: they mock `usePersistentSession` so that `mutate` invokes the per-call
`onSuccess` synchronously, which never models an unmounting observer.

## Goals / Non-Goals

**Goals:**
- A tap on a role row in the rail or the More list always reaches that role's conversation, on
  desktop and phone, for an existing and a new session, in the current and another workspace.
- The close of the More sheet cannot cancel or drop the open.
- A failed open stays visible on the row, with the sheet still standing.

**Non-Goals:**
- Changing what the open-or-resume operation does, the role-row cap, the disabled-row treatment, or
  the worker page itself.
- Any change to non-role links/routes in the shell.

## Decisions

### Navigate from the mutation's own `onSuccess`, not from a per-call callback

`usePersistentSession` gains an optional `onOpened?: (agent: Agent) => void`, invoked from its
`onSuccess` mutation option (alongside the existing `workers` invalidation). `useRoleChatOpen` passes
a callback that navigates to `/w/$ws/workers/$workerId` with the hook's own `ws`.

Why over the alternatives:
- **Per-call `mutate(vars, { onSuccess })` (current).** Observer-gated; dropped on unmount — the bug.
- **`mutateAsync(...).then(navigate)`.** Also unmount-safe, but it changes every caller's contract to
  a promise, forces `.catch` noise, and makes the failure path async while the row's `isError` state
  is already the failure UI. The hook-level `onSuccess` keeps the synchronous `mutate` + `isError`
  contract unchanged.
- **Constructing a second `useMutation` inside `roleChat.tsx`.** Rejected by VS-525: this module is
  not a second implementation of the open-or-resume call.

### The More sheet closes on success, not on click

`RoleChatRow` passes its `onNavigate` to `useRoleChatOpen(ws, onNavigate)`; the hook runs it in the
same `onSuccess` immediately before navigating. On failure nothing closes and `isError` renders the
existing `not opened` state — satisfying "the menu does not swallow it". `RoleChatControl` calls
`useRoleChatOpen(ws)` with no callback and is unchanged in behaviour; the shared fix removes its
theoretical unmount hazard too.

## Risks / Trade-offs

- **`usePersistentSession` grows an option.** It is used only by `roleChat.tsx`, so the option is
  optional and defaulted; both callers are updated in one place.
- **Existing tests assert the per-call callback.** `v2shell`, `v2roles`, `v2project` and `v2rolechat`
  mocks of `usePersistentSession` are updated to accept the options argument and invoke `onOpened` on
  success, so their assertions about which role and workspace open stay meaningful.
- **A failure now leaves the sheet open.** Intended by the ticket; the user sees `not opened` rather
  than being silently dropped on the underlying page.
- **Reproduction evidence.** The bug is proven by a component test using the real
  `QueryClient`/`useMutation` with a deferred response: mounting `RoleChatRow` with an `onNavigate`
  that unmounts it drops the navigation (fails today), while a row that stays mounted navigates
  (passes today). The regression test keeps the unmounting variant.

## Migration Plan

No data or API migration. One frontend release; rollback is reverting the change.

## Open Questions

None.
