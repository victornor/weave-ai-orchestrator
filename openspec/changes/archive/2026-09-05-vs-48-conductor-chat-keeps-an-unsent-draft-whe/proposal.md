# Conductor chat keeps an unsent draft when the human leaves the page

Change for [VS-48](conductor://tickets/VS-48).

## Why

The composer's text lives in component state (`Composer`'s `internal`, or the route's own `useState`).
Navigating to the board, a ticket or settings unmounts the route, so a half-written message is gone by
the time the human comes back — and so is the project they tagged it with and the message they were
replying to. Nothing about the loss is visible until they return to an empty box.

## What changes

- `packages/ui/src/lib/drafts.ts`: a draft is `{ text, replyToId?, projectId? }` held in
  `sessionStorage` under `conductor.draft.<ws>.<conversation>`. `useDraft(key)` reads it, persists
  every change, and re-reads when the key changes. The workspace is part of the key, so no draft
  crosses one; `sessionStorage` rather than `localStorage`, so it survives a reload and a walk around
  the app but does not wait on a shared device for the next person to open the browser.
- The conductor chat binds the composer's text, the project selector and the reply reference to the
  draft for its thread, instead of holding them in route state that dies with the route.
- The ticket page's reply composer and the worker page's steer composer share one draft per ticket:
  both post to the same conversation.
- `Composer` puts the caret after the text of a restored draft, so the human continues the sentence
  rather than typing in front of it.

Sending clears the text and the reply reference; the project pick stays, as it already did between
messages. Clearing the field by hand removes the stored draft.

## Out of scope

Syncing drafts across devices, and the Start Work sheet, whose composer is transient by design.
