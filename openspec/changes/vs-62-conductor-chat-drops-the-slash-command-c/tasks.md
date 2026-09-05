# Tasks

- [x] 1. Remove the three `CommandChip`s under the composer and the `/brief` header label from `ChatRoute`, leaving the rest of the header and composer as they were.
- [x] 2. Remove the `/talk`, `/conductor` and `/d` parsing from `ChatRoute`'s `send()`, and delete the now-unused `CommandChip` component.
- [x] 3. Update the design contract's component list, which named the `/talk ACME-42` command chip.
- [x] 4. Confirm typecheck, lint and both test suites are green, and that no test asserted the chips or the label.
