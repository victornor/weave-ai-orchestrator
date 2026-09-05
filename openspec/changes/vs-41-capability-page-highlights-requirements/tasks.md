# Tasks

- [x] 1. Parse a delta spec into its per-requirement deltas (`parseDeltaRequirements`), including the RENAMED `FROM:`/`TO:` form and the text and scenarios of an added requirement.
- [x] 2. Populate `Requirement.delta` in `getCapability` from every active change touching the capability, appending the requirements only the change adds; type the payload in `packages/core/src/api.ts`.
- [x] 3. Tests: a capability with an active change that modifies, adds and removes a requirement; the no-change case; archived changes producing no delta; the parser's four section kinds; and the capability page rendering the highlight with the ticket identifier.
