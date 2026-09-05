## 1. Derive one entry for the daemon's release state

- [x] 1.1 `updateEntry(status, upgrade)` and `updateEntryLabel(entry)` in `lib/upgrade.ts`: nothing when there is no update to speak of, an `available` entry naming the ref and target commit, an `upgrading` entry naming the stage, with an in-flight upgrade taking precedence.

## 2. Address a Settings section by URL

- [x] 2.1 `useSearchParams` in `app/link.tsx`, and Settings reading its section from `?section=` by key, falling back to the first section for a missing or unknown key.
- [x] 2.2 A tab click still switches on the click and writes the chosen key back into the URL, keeping the rest of the search.

## 3. Show the entry where the operator is

- [x] 3.1 Desktop rail: a self-contained block above the workspace switcher with the title, the target and an "Open Updates" link to `?section=updates`; the dot on the Settings item removed.
- [x] 3.2 Phone: a badge on the More tab, out of flow so the bar geometry is unchanged, and an entry at the top of Settings that opens the Updates section, hidden once that section is shown.

## 4. Cover it

- [x] 4.1 Component tests: the entry appearing, naming its target, linking to the Updates section, switching to the upgrading state and vanishing; the More badge; the deep link opening Updates and the tab writing the URL back.
- [x] 4.2 `pnpm lint`, `pnpm typecheck` and `pnpm test` green.
