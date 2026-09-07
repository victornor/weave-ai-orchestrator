# Mobile dictation stops duplicating every word

Tracker change for [VS-70](conductor://tickets/VS-70). A `task` ticket, so this change carries
tasks only — `skip_specs: true`. No capability specifies how a dictated transcript is assembled;
`conductor-chat/composer-drafts` only requires that whatever dictation transcribed is kept as a
draft, which is unchanged.

## Why

`useDictation`'s `onresult` emitted only the results from `event.resultIndex` on, and `Composer`
appended each emission to a `base` prefix that it advanced on every `final`. That contract is
"append this fragment", and it only survives on desktop Chrome, where each event's changed range
really is the new fragment.

Android Chrome restates the whole utterance so far in each result it sends — `we`, `we also`,
`we also need` — and marks the restatements final. Appending them produces exactly what the owner
reported from their phone: *"we we we also we also need we also need to …"*. The same contract also
loses or repeats text across the restarts `onend` performs, because mobile ends a recognition
session after every phrase and the next one starts a fresh `results` list.

## What changes

- **`useDictation` assembles the transcript and hands over the whole of it.** `onresult` rebuilds
  from index `0` of the results list each event — an interim result is replaced in place at its own
  index, so index `0` is the only reading that cannot double-count it — and calls back with the
  entire transcript dictated since the mic opened. Every call replaces the last.
- **A new exported `mergeTranscript(acc, next)`** joins one segment onto the assembled text: a
  segment whose words repeat everything accumulated so far replaces it (Android's restatement
  shape), anything else is appended with a single space. Comparison is by word, lowercased and
  stripped of punctuation, so a final segment that adds a comma is still recognised as a
  restatement.
- **Restarts carry their transcript forward.** `onend` folds the finished session's text into a
  committed prefix before calling `start()` again, so the fresh `results` list neither repeats it
  nor drops it.
- **`Composer` stops committing.** `base` is the text that was in the box when the mic opened and
  does not move while it is open; each callback rewrites everything after it.

Desktop Chrome's shape is unaffected: distinct segments do not restate one another, so they are
still appended, and the transcript reads as it did. Push-to-talk, tap-to-toggle, send-stops-the-mic
(VS-29) and the draft persistence (VS-48) all work off the composer value, which now simply holds
de-duplicated text.

## Out of scope

Server-side transcription — the owner declined it on 2026-09-05. Upload mode is untouched beyond
the callback now meaning "the whole transcript", which for a one-shot upload is the same string.
