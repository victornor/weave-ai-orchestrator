# Send automatically when dictation ends

Tracker change for [VS-435](weave://tickets/VS-435). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

Captain, 2026-09-14: an opt-in **"Send automatically when dictation ends"** setting. With it on,
finishing a dictation is the same act as pressing the send arrow — the message goes out once the
transcript has landed, with no second click. Dictating a short instruction should be one gesture,
not "hold the chord, release, reach for the arrow".

A dictation session ends in three ways, and all three have to auto-send:

- the push-to-talk chord is released (VS-432's hold mode);
- a toggle session is pressed off (VS-432's tap mode);
- the on-screen mic button stops it.

Today a send is already queueable: pressing the arrow while dictating or transcribing queues it,
and the composer submits once the attempt settles, with whatever text landed, and nothing when the
result is empty or failed (VS-282, VS-416). The setting must ride that path, not grow a second
send implementation, so it inherits every behaviour a real send has — the full draft (existing
text plus the transcript), attachments, reply target, project scope, the queued/offline notice,
the Plan modal's own submit, and the "Send queued" cue.

## What changes

- **A per-browser preference**, `packages/ui/src/lib/dictationAutoSend.ts`, in the same shape as
  the diagnostics toggle (`conductor.dictationAutoSend`, its own event so a mounted composer
  follows a change without a reload). Off by default; it is a device-local UI habit, not daemon
  state, so it belongs in `localStorage` and not in `daemon.yaml`.
- **The setting** in Settings → Dictation (`DictationSection`, shared by V1 and V2), a labelled
  switch with a one-line explanation.
- **Every way a session ends arms the existing queued send.** Both composers route
  their stop through one handler that, when the setting is on and the composer is enabled, sets
  the existing `pendingSend` state before calling the hook's `stop`. The existing effect then
  submits the settled draft exactly as a queued arrow press does. A session that ends in an error
  or an empty transcript submits nothing.
- **V2's send button gets the queued cue V1 already has** (`Send queued`, spinner, disabled) so
  the state is visible on the UI that is now primary.
- **Tests, V1 and V2**: the preference defaults off and persists; setting off → an ending sends
  nothing; setting on → hold-release, toggle-off and the mic button each send once, with the full
  draft, after the transcript lands; an empty or failed transcript sends nothing; a second press
  while queued does not double-send.

## Out of scope

- The Ctrl/⌘+Shift+Space chord itself (VS-432).
- The dictation reveal animation (VS-425) and the voice meter (VS-431).
