## Why

VS-63 and VS-79 both shipped fixes for the conductor chat not reliably scrolling to the bottom on a
new message, and captain still hits it intermittently. This change starts from the ticket's own hard
requirement — reproduce before changing anything — and reports the result of a genuine attempt:
code review of the follow mechanism plus live, real-browser (headless-Chromium, CDP-driven, not
jsdom-mocked) tests of the three triggers the ticket names as most plausible (content that grows
height after the scroll fires, a burst of rapid streaming messages, and growth landing mid-animation).
All three self-corrected reliably through the existing `ResizeObserver`-based re-pin in
`packages/ui/src/lib/stickToBottom.ts` — none reproduced a stuck-short scroll.

What the investigation did find, with file:line evidence, is a real gap that explains why two prior
fixes could ship green and still fail for the human: every existing scroll regression test
(`packages/ui/src/test/chat.test.tsx:219`) stubs `Element.scrollIntoView` as a no-op `vi.fn()` and
asserts only that it was *called*, never that the list actually reached its true bottom. A fix that
scrolls to a stale position passes every test that exists today.

Per this workspace's standing rule for a bug that only reproduces on the human's own device (ship a
diagnostic capture first, fix from the recorded data second), and per this ticket's own explicit
fallback ("if after genuine effort you cannot reproduce it, stop and say so ... ship instrumentation
instead"), this change does not attempt a third blind fix. It (1) makes the test suite verify the
real invariant — final scroll position, not call count — so the gap that let two fixes slip through is
closed regardless of what the actual bug turns out to be, and (2) ships an opt-in diagnostic recorder
so captain can trigger the bug once and the next attempt works from a real recorded sequence instead
of another guess.

## What Changes

- Formalize the chat's scroll-follow behavior as a spec, including the "ends at the true bottom, not
  merely issues a scroll call" invariant that today exists only in code and was never written down or
  tested end to end.
- Strengthen `packages/ui/src/test/chat.test.tsx`'s `scrollIntoView` stub to actually track a
  simulated scroll position (matching the fake `scrollHeight`/`clientHeight`/`scrollTop` geometry the
  tests already stage) instead of a bare call-count spy, and add regression tests asserting the list
  ends at its true bottom after late-arriving content growth and after a rapid burst of messages —
  the two conditions this investigation drove deliberately in a real browser.
- Add a bounded, opt-in diagnostic recorder (`packages/ui/src/lib/scrollDiagnostics.ts`) wired into
  `useStickToBottom`'s scroll listener, content-follow effect and geometry re-pin effect: a capped
  ring buffer of `{t, event, scrollTop, scrollHeight, clientHeight, atBottom, following, opened}`
  samples, inert unless explicitly enabled, with a console-reachable export so captain can capture and
  hand over the actual sequence the next time this happens.
- No change to `stickToBottom.ts`'s actual scroll/follow logic: no defect was confirmed in it, and
  changing it without a confirmed cause is exactly the guess this ticket asks not to repeat.

## Capabilities

### New Capabilities
- `conductor-chat/scroll-follow`: the message list's follow-the-bottom behavior — opens at the newest
  content once loaded, follows new content while at the bottom, pauses on a manual scroll up, resumes
  on a manual return to the bottom, corrects to the true bottom when content or the container's
  geometry changes after it has already scrolled, and exposes an opt-in diagnostic capture of that
  state for use when the behavior is suspected wrong on a device this investigation cannot reach.

### Modified Capabilities
(none — no existing capability's requirements change)

## Impact

- `packages/ui/src/lib/stickToBottom.ts` — diagnostic recording calls added at existing measurement
  points only; no behavioral change.
- `packages/ui/src/lib/scrollDiagnostics.ts` — new, small (ring buffer + enable flag + export).
- `packages/ui/src/test/chat.test.tsx` — stronger `scrollIntoView` fake; new assertions on final
  scroll position for the two triggers reproduced in this investigation's real-browser testing.
- No API, schema or CLI surface changes. No change to the phone-keyboard viewport mechanism
  (`workspace-navigation/phone-keyboard-viewport`), which this investigation's real-browser testing
  did not implicate.
