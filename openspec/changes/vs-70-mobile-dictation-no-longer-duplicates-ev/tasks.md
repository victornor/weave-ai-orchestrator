# Tasks

- [x] 1. Add `mergeTranscript` to `packages/ui/src/lib/dictation.ts`: word-level, punctuation-insensitive comparison that replaces the accumulated text when a segment restates it and appends otherwise.
- [x] 2. Rebuild the session transcript from index `0` of `event.results` in `onresult` and emit the whole transcript dictated since the mic opened, not the fragment from `resultIndex`.
- [x] 3. Carry a finished recognition session forward into a committed prefix in `onend` before restarting, so continuous-mode restarts neither repeat nor lose what was said.
- [x] 4. Stop `Composer` advancing `base` on final results — the callback now replaces everything after the pre-mic text.
- [x] 5. Tests: the reported Android sequence of cumulative final restatements yields each word once; a session restart mid-sentence keeps the committed text and adds the new phrase once; desktop's distinct-segment shape still concatenates; existing VS-25/VS-29 dictation tests stay green.
