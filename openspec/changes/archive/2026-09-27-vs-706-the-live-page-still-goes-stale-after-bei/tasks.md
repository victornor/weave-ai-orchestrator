## 1. Reproduce

- [x] 1.1 Against a scratch daemon (not the live unit, not port 7433), open the real Live page in a real browser and leave it. Try a backgrounded tab past the watchdog window, a timer gap standing in for sleep, and a long idle visible tab. Record which ones leave the page stale while a reload is current, and whether a reconnect or a worker refetch happened. Attach the stall capture to the ticket. Verify by a ticket comment naming the reproducing case and the ruled-out ones.

## 2. Failing test

- [x] 2.1 Add a test that fails on the current code for the mechanism 1.1 confirmed (unseen-workspace resync gap, missing wake signal, or both). It asserts the reads moved, not merely that a reconnect was called. Verify by running that file and seeing it fail before the fix.

## 3. Fix the shared stream

- [x] 3.1 Apply the confirmed fix in `useLiveStream`, `EventStream` and `GlobalEventStream`, including a reconnect that refreshes every workspace whose reads the document already holds. A hidden document still closes its connection and gains no extra one. Verify the new test passes, and `sseStream.test.tsx` plus `connectionBudget.test.tsx` stay green.

## 4. Evidence and delivery

- [x] 4.1 In the same scratch-daemon browser, leave Live past the reproduction window and return. It updates by itself within a few seconds, in light and dark. Attach both captures to the ticket, outside `work/`. Verify `git status --porcelain` in the worktree is empty of those files.
- [x] 4.2 PR description states the reproduction steps and the root cause in one paragraph. Verify the paragraph names the case from 1.1 and the mechanism the test covers.
