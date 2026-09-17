# VS-489 — Escape cancels a dictation, and the multi-pane session belongs to the focused pane

Rendered evidence from a real Chromium page mounting the **real** `DictationSessionProvider` and
`ChatComposer` from `packages/ui/src`, in dark and light. The fix is entirely in those components
(the session's target, the in-composer dictation slot, and the Escape cancel), so the harness renders
them directly rather than the whole app: two `ChatComposer`s in one provider stand in for the V2
Chats view, one `focused` and one not.

## How they were made

Throwaway harness in `/tmp` (not committed): a Vite dev server serving the worktree source, with
Playwright-core headless Chromium (`/usr/bin/chromium`) launched with
`--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`. `page.route` fulfilled
`/api/health` with `{ transcription: { backend: 'voxtype', configured: true } }` so the real hook
takes the daemon/upload path with the fake microphone, and `/api/transcribe` was made slow (2.5 s)
so a transcript could not land before the Escape. Viewport 1000×640; nothing reached the live daemon.

## Measured on the page (identical for dark and light)

| Scene | Assertion | Value |
|---|---|---|
| cancel | mic buttons present / clicked | 1 |
| cancel | `[data-testid=v2-composer-listening]` while recording | 1 |
| cancel | after Escape: listening slot | 0 |
| cancel | after Escape: textarea value | `prior words` (the pre-dictation draft) |
| cancel | after Escape: draft store `conductor.draft.acme.thread:t1` | `{"text":"prior words"}` |
| cancel | POSTs to `/api/transcribe` | 0 |
| cancel | `onSubmit` calls | 0 |
| cancel | off-page dictation bar | absent |
| multi | mic buttons | 2 (focused enabled, non-focused disabled) |
| multi | `[data-testid=v2-composer-listening]` total | 1 |
| multi | listening slot in the focused pane / in the other pane | 1 / 0 |
| multi | `[data-testid=v2-dictation-bar]` | 0 (absent) |
| multi | `onSubmit` calls | 0 |

Zero console errors and zero page errors in every scene.

## What each capture shows

| File | Shows |
|---|---|
| `vs489-cancel-listening-{dark,light}.png` | the focused composer mid-dictation: the in-composer recording slot (pulse, `0:00`, stop control), no floating bar |
| `vs489-cancel-after-{dark,light}.png` | after Escape: back to the textarea holding `prior words` exactly, nothing sent, no listening slot |
| `vs489-multi-focused-{dark,light}.png` | two panes in one provider: the focused pane records in-composer (waveform + stop), the other is idle with a disabled mic, and the off-page bar is absent |

## Notes

- The 2.5 s `/api/transcribe` route was **never called** in the cancel scene — Escape aborts before
  `stop()` builds the WAV — so the signed assertion is the route-call counter, not a stubbed reply.
- These captures were taken before the same-ticket scope addition that retired the "Send
  automatically when dictation ends" setting (VS-435); that setting and its switch no longer exist.
  The Escape path shown is unchanged by its removal, and the Stop-keeps-the-transcript path is
  unit-covered (below).
- Unit coverage in `packages/ui/src/test/v2chatcomposer.test.tsx` and
  `packages/ui/src/test/v2dictationsession.test.tsx`: the mic control, the bar Stop and the chord's
  release/toggle-off each leave the transcript and submit nothing; an explicit send still submits
  once; Escape discards and restores the pre-dictation draft. The focused-pane behaviour (target in
  the focused pane's draft; a second pane refused; the bar only once focus leaves the target pane)
  is in `v2dictationsession.test.tsx` too.
