# Tasks — VS-442

## 1. One shared conversation view

- [x] 1.1 `packages/ui/src/v2/ChatConversation.tsx`: extract the scrolling message list
      (`ChatMessage` + `ChatTurnTrace`), the live working section (`useRunEventStream`, the working
      indicator, the dropped-stream retry and the `ChatTrace reveal`) and the stick-to-bottom follow
      into one component, parameterised by rows, live run, actor name and the weaver-only render
      extras; `useLiveRunSettle` is shared too.
- [x] 1.2 `packages/ui/src/v2/ChatPage.tsx`: render the shared view, passing the weaver-only extras
      (inline decision cards, dispatch chips, the unattributed-worker row) as render props, and delete
      the duplicated markup.
- [x] 1.3 `packages/ui/src/v2/ChatTrace.tsx`: `ChatTurnTrace` takes an actor name, so a turn's summary
      reads "Planner did …" as well as "weaver did …", and its aria-label follows.

## 2. The planner conversation on the shared view

- [x] 2.1 `packages/ui/src/v2/PlanModal.tsx`: render the shared conversation; track the planner's live
      run (`fromStart` on `run.started`, cleared when its message lands or after the settle delay) and
      follow its event stream; rows from the plan thread plus the run traces behind its replies.
- [x] 2.2 Planner context: markdown messages and clickable ticket references; the per-turn "Planner
      did N tool calls · tokens · session size" summary; the live working trace. Omitted: inline
      decision cards, the reply-to-message control, dispatch chips and the unattributed-worker row.
      The drafts pane and the composer (VS-428) are unchanged.
- [x] 2.3 Server: `POST /projects/:id/plans/start` returns the planner agent's `runtimeId` (the only
      server gap), and the modal resolves the summary's session figure from that runtime's models.

## 3. Tests

- [x] 3.1 `packages/ui/src/test/v2planmodal.test.tsx`: a planner reply renders markdown (heading, list,
      inline code); a finished turn shows the summary with "Planner", its tool-call count, tokens and
      session figure; a running planner renders the live trace; the reply control is absent.
- [x] 3.2 `packages/server/test/plans.test.ts`: the start response carries the planner's `runtimeId`.
- [x] 3.3 `v2chat.test.tsx` and `v2chattrace.test.tsx` unchanged and green.

## 4. Verification and evidence

- [x] 4.1 `pnpm lint && pnpm typecheck && pnpm test` green; both suites pasted verbatim in the ticket
      comment.
- [x] 4.2 Evidence: real-browser captures, dark and light, of the Plan modal (a markdown reply; a
      collapsed and an expanded "Planner did …" turn; a live trace mid-turn) beside the matching
      weaver-chat frames. Absolute paths in the PR.
