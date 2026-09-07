## 1. The licences

- [x] 1.1 `LICENSE` at the root: the verbatim AGPL-3.0 text, `Copyright (C) 2026 Victor Nor`.
- [x] 1.2 `ee/LICENSE`: a commercial licence for this project — free development, evaluation, testing and contribution; production use requires a licence key; no anti-circumvention workarounds, no redistribution, no offering it as a service.
- [x] 1.3 `ee/README.md`: what belongs under `ee/`, the two-licence split, and the `"license": "SEE LICENSE IN ee/LICENSE"` convention for packages that land there.
- [x] 1.4 `CLA.md`: an individual CLA on the Apache ICLA structure with a relicensing grant.

## 2. The metadata

- [x] 2.1 `"license": "AGPL-3.0-only"` in the root `package.json` and in all 26 workspace packages.
- [x] 2.2 A "Licence and contributing" section in `README.md` pointing at `LICENSE`, `ee/LICENSE` and `CLA.md`.

## 3. The audit (reported, not acted on)

- [x] 3.1 Secret scan of the full git history with `gitleaks` and `trufflehog`; findings with a recommended action each.
- [x] 3.2 Licence table for every production dependency; anything GPL-incompatible, unknown or unlicensed flagged.
- [x] 3.3 Public-eyes read of every file under `docs/design/`, `docs/prompts/` and `docs/research/`, one line each.
- [x] 3.4 The three lists delivered as the ticket's report document.

## 4. Green

- [x] 4.1 `pnpm lint`, `pnpm typecheck` and `pnpm test` green.
