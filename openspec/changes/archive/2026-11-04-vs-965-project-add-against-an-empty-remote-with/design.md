## Decisions

**D1. Undo, not avoid.** Keep committing before pushing (worktrees must branch from a clean tree) and make the failure path correct, rather than moving the commit into a scratch worktree. Smallest change that makes the "never ahead of origin" promise true.

**D2. Root commit detection.** `git rev-parse --verify --quiet HEAD^` fails exactly when HEAD has no parent. Root: `git update-ref -d HEAD`, which leaves index and working tree intact. Otherwise `git reset -q --mixed HEAD~1`. A single-commit clone gaining a second commit is the non-root case and already worked.

**D3. Honest logging.** The undo result decides the message: success logs the existing warning; failure logs an error saying the clone is ahead of origin and must be reset by hand.
