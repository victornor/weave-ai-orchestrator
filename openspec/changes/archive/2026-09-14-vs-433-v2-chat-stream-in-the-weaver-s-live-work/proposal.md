# V2 chat: stream the live working trace line by line

Tracker change for [VS-433](weave://tickets/VS-433). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

Captain, 2026-09-14: in the weaver chat the live **working trace** (the lines under "Weaver is
working") should animate. Each new line should stream its text in quickly, the same way dictated
text does (VS-425), instead of appearing whole. "Nothing special."

VS-425 gave the chat a streaming reveal for a new weaver reply and the composer's dictated text
(`packages/ui/src/lib/streamReveal.ts`), but the live trace (`ChatTrace`, fed by `liveEvents` in
`ChatPage`) still pops every row in whole. The trace is the one place text *arrives* — narration
sentences, tool arguments, command output — so it is where a pop is most visible.

## What changes

- **`useStreamReveal` follows growth.** Its interval restarts on every `full` change, so a line whose
  text grows mid-reveal (a streamed `assistant.text` block, which the transcript builder appends to
  in place) flickers back toward its first character. The hook now keeps a small linear ramp from
  what is already shown to the new end and extends it on growth, so the visible prefix only ever
  lengthens. Fixed text (a reply) behaves exactly as before.
- **`useNewLiveIds(events)`.** The reveal baseline for the live trace: a run event whose `seq` is
  greater than the highest `seq` present when the trace mounted is new. `seq` is per-run and the one
  field a persisted row and its live frame agree on (`mergeRunEvents`), so a line's identity survives
  the persisted read replacing the live tail. What was on screen at mount — a history read back, a
  mid-turn join — is the baseline and never animates.
- **`ChatTrace` gains a `reveal` prop** (default `false`, so history is untouched). When set, a
  `TraceLine`'s text and a single `ToolRow`'s one-line target reveal from nothing to the whole; a
  tool group and its children stay whole. `ChatTurnTrace` never passes it, so an expanded past turn
  never animates.
- **`ChatPage` passes `reveal` to the live `<ChatTrace>`** only.
- **Reduced motion renders whole**, through the existing `usePrefersReducedMotion`.
- **Multi-line result bodies and edit previews keep VS-427's `v2-anim-fade`** and do not reveal
  character by character. Each line owns its reveal, so several arriving together do not block later
  ones.

## Out of scope

The dictation shortcut (VS-432), the voice-meter width (VS-431), and any trace content or grouping
change. No scroll work: stick-to-bottom's exact-mode rAF loop already follows a growing reveal
(VS-425).
