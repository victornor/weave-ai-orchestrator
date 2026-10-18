## 1. Core

- [x] 1.1 In `projects.update()`, verify the new remote (ls-remote for reachability and default branch) before any write
- [x] 1.2 Set `origin` to the new URL, fetch, roll back `origin` on failure; write `gitUrl` with the other row fields
- [x] 1.3 Core tests against local bare repos: success, unreachable, missing default branch, old repo untouched

## 2. Server and UI

- [x] 2.1 Confirm the PATCH route accepts `url`; add it if not
- [x] 2.2 Add the repo-URL field and save to Settings → Projects with inline error handling
- [x] 2.3 UI test: shows current URL, saves a new one, shows the refusal error
