# Tasks

- [x] 1. Make `useStickToBottom` refuse to position a list that is not `ready`, so the opening jump cannot be spent before the content it opens on exists, and document what `ready` means.
- [x] 2. Expose the hook's live `following` ref on `StickToBottom`, for a caller whose own scroll listener has to tell the follow's scrolling from the human's.
- [x] 3. Pass `ready: messages.data !== undefined` from `ChatRoute`, and show the loading skeleton rather than the empty-thread pitch while the history query has no data and no error.
- [x] 4. Record a reading position only when the follow is paused and the list is away from its bottom; restore only once the history has loaded, keyed by the workspace restored.
- [x] 5. Attach the scrolling element through the hook's stable `scrollRef` instead of the `stick` object, so the ref is not detached and re-attached on every commit.
- [x] 6. Tests: the history query can report "no data yet"; the opening jump waits for the history and is instant, the follow after it still animates, the first render shows loading, the follow's own scrolling is not recorded, and the restore happens after the history rather than onto the empty list. All four fail without the fix.
- [x] 7. Update the `Chat's reading position survives a workspace switch` requirement for what counts as a reading position and when it is restored.
