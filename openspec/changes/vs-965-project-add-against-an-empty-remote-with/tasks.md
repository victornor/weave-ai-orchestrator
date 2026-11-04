## 1. Undo the adoption commit correctly

- [ ] 1.1 In `bootstrapOpenSpec`, after a failed push, undo the commit with `git update-ref -d HEAD` for a root commit and `git reset -q --mixed HEAD~1` otherwise (design D2); check the exit status and log the warning or an error accordingly (D3). Verify with tests in `projects.test.ts` using a bare remote with a rejecting `pre-receive` hook: empty remote leaves an unborn branch with the scaffold uncommitted; remote with history leaves HEAD at its prior commit.
