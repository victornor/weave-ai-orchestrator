# V2 Plan modal gets the weaver chat's composer

Tracker change for [VS-428](weave://tickets/VS-428). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

Captain, 2026-09-14: "The planning chat modal has to be entirely like the normal weaver chat. You
should be able to do voice dictation. You should be able to attach files. The planning mode should
look identical to the weaver chat. It's just a different context."

`packages/ui/src/v2/PlanModal.tsx` (VS-398) renders its own `<textarea placeholder="Talk through the
plan…">` and a plain `Send` button. It has no dictation, no attachments and none of `ChatComposer`'s
send/disabled/error handling. The weaver chat uses `packages/ui/src/v2/ChatComposer.tsx` — the shared
composer with the VS-416 listening state, `useDictation`, attachments by picker/paste/drag, and the
identical attach/dictate/send controls.

## What changes

- **One composer, not two.** `PlanModal` renders `ChatComposer`; the bespoke textarea and Send button
  are deleted. The composer's chat-only chrome is hidden through props rather than a fork: the
  project scope selector is not rendered (`showScope={false}` — the plan is already bound to one
  project, chosen by the modal's own header) and the Search and Plan buttons are absent because the
  plan modal passes neither handler. The dictation hint stays.
- **The input names the planner.** `ChatComposer` gains optional `placeholder`/`ariaLabel` props so
  the plan modal says "Message the planner", with the weaver chat's wording as the default.
- **Dictation belongs to one composer at a time.** The plan modal and the chat behind it are both
  mounted, so `ChatComposer` gains a `hotkey` prop: the chat hands the global push-to-talk hotkey to
  the modal while it is open, instead of both dictating at once.
- **Attachments reach the planner.** `PlanModal`'s submit passes the files to
  `usePostThreadMessage`, exactly as the chat does. The plan's thread is owned by the planner agent,
  and `threads.inbound` already wakes that agent with `attachmentIds` for a non-ticket-bound thread
  — no backend change is needed.
- **The plan conversation shows what was sent.** The message bubbles render `AttachmentRows` (the
  shared component the weaver chat uses) so a sent image or text file is visible in the plan thread.
- **Tests.** The Plan modal suite asserts it renders the shared composer with attach and dictate
  controls, that the scope selector and Search/Plan buttons are absent, that a send carries an
  attachment through to the plan thread, and that the chat behind it stops listening for the hotkey
  while the modal is open.

## Out of scope

- Chat scrolling and reveal animations (VS-425) and the motion polish pass (VS-427).
- The planner's own behaviour and the plan draft list.
