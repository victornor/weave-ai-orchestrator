## Context

- `useDictation` (`packages/ui/src/lib/dictation.ts`) already exposes `mode: 'speech' | 'upload' |
  'unavailable'`. `'upload'` is set only when the daemon backend is Voxtype and ready
  (`pickMode`); it is the one non-streaming path. `mode` is resolved automatically from
  `GET /api/health`, so `Composer.tsx` never has to be told which backend is active — it already
  reads `dictation.mode`.
- `stop()` today: sets `listening` false synchronously, builds the WAV, calls `postWav(blob)`
  fire-and-forget, and returns. `postWav` resolves the fetch some time later (a further ~2.5s per
  captain's log) and either calls `cb.current(text, true)`, sets an error, or — if `json.text` is
  falsy — does nothing at all. There is no state anywhere that is true for that window.
- `Composer.tsx`'s dictating row (`dictating ? <row> : null`, `dictating = dictation.listening`) is a
  fixed-height band under the input that shows the meter (upload mode, since `metered` is true once
  `getUserMedia` resolves) or a pulsing "Listening…" label (speech mode, which has no stream to
  meter). The textarea itself is never disabled by dictation state today, only by `disabled`/
  `submitting` (an in-flight send).

## Decision: disable the composer, do not hide it

Captain left this open. Disabling wins over hiding:

- **Consistency.** The composer already locks itself this same way — `disabled={disabled ||
  submitting}` — while a send is in flight. Recording is the same shape of "an operation owns this
  box right now"; reusing the pattern needs no new mental model.
- **No layout jump.** The dictating band already exists as a fixed-height region precisely so the
  input's position does not move while recording (see the comment on `MAX_INPUT_PX` / the
  dictating-row styling). Hiding the textarea would fight that: the band would have to grow to fill
  the space, then shrink back, twice per dictation.
- **Nothing looks lost.** The textarea may hold text typed before the mic opened (`base.current`);
  hiding it would look like that text vanished. Disabling keeps it visible and legible, just inert.
- **The mic/stop control still needs a home.** Hiding "the composer" while keeping the mic button
  reachable means keeping part of the same row anyway — at that point disabling the rest is simpler
  than a partial hide.

So: while `mode === 'upload'` and (`listening` or `transcribing`), the textarea, the attach control
and the send control get `disabled`. The mic/stop control is the one thing that must stay live during
`listening` — it is the only way to end the recording — and is itself disabled during `transcribing`,
since there is nothing left to stop and starting a second recording while the first is still being
transcribed is not a state this hook is built to hold concurrently.

## Two indicators, not one

Acceptance criterion 1 asks for a listening indicator that communicates two separate facts at once
("capturing now" and "processed once you stop"); criterion 2 asks for a *visually distinct*
transcribing indicator. Reusing one label for both phases (e.g. just keeping "Listening…" lit until
the text arrives) would satisfy neither: the human would not be able to tell, from the screen alone,
whether their voice is still being captured or whether they can stop.

- **Listening** (`dictation.listening`, upload mode): existing meter + elapsed timer, plus a caption
  line — always visible, not hidden below a breakpoint the way the existing desktop-only "click the
  mic to stop" hint is, since a phone is exactly where Voxtype's non-streaming gap is most confusing —
  stating both halves: capture is happening, and it becomes text once recording stops.
- **Transcribing** (`dictation.transcribing`, upload mode only, `listening` false): the meter row is
  replaced by a spinner and a "Transcribing…" label. No timer (elapsed time stops meaning "how long
  have I been talking" the moment recording stops).

Speech mode keeps exactly its current row and caption; `transcribing` is always `false` there, so none
of this is reachable on the Chrome path.

## `transcribing` lifecycle

`transcribing` becomes `true` synchronously inside `stop()`, only when the session being stopped was
an upload session (`uploadLive.current` was `true`), at the same point `postWav(wav)` is invoked.
`postWav`'s fetch chain resolves it back to `false` in every branch — success, empty `text`, a non-OK
response, a 501 (provider became unconfigured), and a network failure — via a single `.finally`, so
there is exactly one place that can leave it stuck and it is exercised by all three outcomes named in
acceptance criterion 3.

## Non-goals

- No change to `mergeTranscript`, the speech-mode restart/duplication handling, or diagnostics
  capture — none of that is touched by this change.
- No change to what happens with an empty transcript beyond "the composer is not left locked" — the
  companion ticket on degenerate transcription owns surfacing that outcome to the human.
