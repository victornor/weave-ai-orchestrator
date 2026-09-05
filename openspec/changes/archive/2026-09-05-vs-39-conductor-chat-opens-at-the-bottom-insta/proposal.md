# Conductor chat opens at the bottom and pages its history

Tracker change for [VS-39](conductor://tickets/VS-39). A `task` ticket, so this change carries
tasks only — `skip_specs: true`.

## Why

`useThreadMessages` asks for `limit: 200` in one request and `ChatRoute` renders the whole answer
from the top, then calls `scrollIntoView({ behavior: 'smooth' })` on a bottom sentinel. The human
sees the oldest messages first and watches the view travel down to the newest. Today that is a
flicker; the payload and the render both grow with the thread, and the travel gets longer with them.

`GET /threads/:id/messages` already pages on `created_at <` with a `before` cursor
(`packages/core/src/threads/service.ts`), so the client can start with one recent page.

## What changes

- `useThreadMessages` becomes an infinite query over the existing `before`/`limit` cursor: one page
  of 30 newest messages first, older pages fetched on demand. Pages come back newest-page-first, so
  the hook flattens them into the oldest-first order the chat renders. A short page means the
  beginning of the thread.
- **`useStickToBottom` grows the other end of the list.** VS-38 landed first with the follow
  behaviour and the scroll-to-bottom button over the same container, so the paging goes into that
  hook rather than into a second one measuring the same element: the opening position becomes a jump
  instead of an animation, reaching the top asks for the older page, and a layout effect holds the
  viewport by distance-from-bottom while that page is prepended — and marks the change seen, so the
  follow does not read a prepend at the top as new content at the bottom.
- The chat shows a short loading row above the history while an older page loads, and stops asking
  once the API returns a short page.

The API's shape and page size are unchanged: anchoring needs nothing from the server that the
`before` cursor does not already give. `PageBody`'s `scrollRef` came from VS-38 and is used as-is.

## Out of scope

Search within history.
