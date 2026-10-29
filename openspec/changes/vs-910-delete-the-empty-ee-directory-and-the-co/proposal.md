## Why

`ee/` holds two tracked files, a commercial licence and a README that ends "Nothing lives here yet". A reader finds a full commercial licence guarding no code, which looks like a mistake or something withheld. The convention can be re-established when a paid feature exists.

## What Changes

- Delete `ee/LICENSE` and `ee/README.md`.
- `README.md`, `CONTRIBUTING.md`: remove the claim that paid features live in `ee/`; still tell contributors plainly that the project may relicense their work, including commercially.
- `CLA.md` section 4: keep the relicensing grant, replace the "(the `ee/` directory)" path with directory-independent wording that grants no more and no less than before.
- Not changed: root `LICENSE` (AGPL-3.0), git history, `openspec/changes/archive/**`.

## Capabilities

### New Capabilities
- `repository-licensing`: what the repository's licence documents say about commercial licensing.

### Modified Capabilities

## Impact

Documentation and two deleted files only. Nothing under `ee/` was ever imported; build, typecheck and tests are unaffected.
