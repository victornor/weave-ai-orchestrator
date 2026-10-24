## Decision: unset the push URL rather than set it

A re-point replaces the whole remote, so a push URL that differed from the old fetch URL has no meaning for the new one. Clearing `remote.origin.pushurl` (`git config --unset-all`) makes push follow the fetch URL, and leaves no second value to go stale at the next re-point. Setting it to the new URL would work too but pins a value that must be maintained. An absent key is exit code 5 from git and is not an error.

## Verification and rollback

After the writes, read `git remote get-url origin` and `git remote get-url --push origin`; both must equal the new source, otherwise throw `internal` and roll back. Before any write, capture the previous fetch URL and `git config --get-all remote.origin.pushurl`. Rollback restores the fetch URL and re-adds each previous push URL. It runs on a failed fetch or a failed verification.
