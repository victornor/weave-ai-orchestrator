## 1. Assignment helper

- [x] 1.1 Change `projectColorVar` in `packages/ui/src/lib/projectColor.ts` to
      `projectColorVar(id, siblingIds = [])`: greedy ULID order, prefer hash slot, else first
      free, else least-used with the design.md tie-break. Keep the same `PALETTE` and FNV-1a.
      Verify `projectColorVar(id)` with no siblings still matches today's hash colour for a
      known id.

- [x] 1.2 Extend `packages/ui/src/test/projectColor.test.ts`: two ids that hash to the same
      slot get different colours when both are in `siblingIds` and a slot is free; a later id
      does not change an earlier id's colour; a new id while a slot is free never reuses a
      colour already in the set; when every slot is taken the next id gets a least-used
      colour; same `(id, sibling set)` is stable. Verify
      `pnpm --filter @agent-conductor/ui exec vitest run src/test/projectColor.test.ts`.

## 2. Surfaces

- [x] 2.1 Pass the workspace's full project-id list (including archived) into
      `projectColorVar` from `WorkspaceNav.tsx` and from `Chat.tsx` (dispatch labels, worker
      chips, `ProjectPicker` tags and the orphan tag). Verify
      `workspacenav.test.tsx` and `chat.test.tsx` still pass after updating expected colours
      to `projectColorVar(id, allIds)`.

- [x] 2.2 Run `pnpm lint && pnpm typecheck && pnpm test` and confirm all are green.
