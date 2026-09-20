## Why

Tapping a role row in the V2 shell does not reliably open that role's persistent chat: on a phone,
where the row lives in the **More** sheet, the sheet closes and the person is left on the page behind
it — usually the workspace's **Needs you** screen — instead of the conversation. The open-or-resume
call is started *after* the sheet is told to close, so the row unmounts while the request is in
flight and the per-call `onSuccess` that performs the navigation is dropped (TanStack Query only runs
a `mutate(vars, { onSuccess })` callback while its observer still has listeners). The failure is
invisible in the existing tests because they resolve the mutation synchronously through a mock.

## What Changes

- Start the open-or-resume call and navigate from the mutation's **own** `onSuccess`, which runs
  whether or not the row is still mounted, instead of from the per-call callback passed to `mutate`.
- `RoleChatRow` closes the phone **More** sheet only once the open has succeeded — navigation and the
  close happen together on success, so closing the sheet can no longer cancel the open.
- A failed open keeps the row mounted (the sheet stays open) and shows the row's existing
  `not opened` state, rather than the sheet swallowing the failure.
- Audit the other caller of `useRoleChatOpen` (`RoleChatControl`, on the project overview and the
  Roles screen) for the same unmount hazard; it opens without closing its surface, and shares the
  same fix.

## Capabilities

### New Capabilities
<!-- None. This changes the behaviour of an existing capability. -->

### Modified Capabilities
- `web-v2/navigation`: the role-row requirement gains the guarantee that activating a role row opens
  the persistent conversation even when the shell's More sheet unmounts the row, and that a failed
  open remains visible on the row.

## Impact

- `packages/ui/src/v2/roleChat.tsx` — `useRoleChatOpen`/`RoleChatRow` navigation and close ordering.
- `packages/ui/src/api/hooks.ts` — `usePersistentSession` accepts an open-succeeded callback so the
  navigation lives in the mutation's own `onSuccess`.
- `packages/ui/src/v2/V2Shell.tsx` — how `ProjectRow` passes the More sheet's close to `RoleChatRow`.
- Tests: `v2rolechat.test.tsx`, `v2shell.test.tsx`, and the `usePersistentSession` mocks in
  `v2roles.test.tsx` / `v2project.test.tsx`; new async-under-unmount regression tests.
