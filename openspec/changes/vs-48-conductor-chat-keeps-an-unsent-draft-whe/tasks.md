# Tasks

- [x] 1. Add `packages/ui/src/lib/drafts.ts`: the `Draft` shape, `draftKey(ws, conversation)`, `readDraft`/`writeDraft` over `sessionStorage`, and `useDraft(key)` which persists every change and re-reads when the key changes.
- [x] 2. `Composer` places the caret at the end of the text it mounts with, so a restored draft is continued rather than edited from its start.
- [x] 3. The conductor chat holds its text, project pick and reply reference in the thread's draft; sending clears the text and the reference and keeps the project pick.
- [x] 4. The ticket page's reply composer and the worker page's steer composer share one draft per ticket.
- [x] 5. Tests: leave-and-return restore with the caret at the end, clear on send, clearing the field by hand, per-workspace isolation, switching conversation, and the reply reference and project tag restored with the text.
- [x] 6. Spec deltas: the new `conductor-chat/composer-drafts` capability, and the project selector's default amended for a session draft.
