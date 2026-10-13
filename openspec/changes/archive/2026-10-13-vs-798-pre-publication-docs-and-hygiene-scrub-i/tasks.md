## 1. Scrub
- [x] 1.1 Remove/generalise `docs/OPERATIONS.md` §9 host details and fix links to it
- [x] 1.2 Neutral address and server name in `credentials.test.ts`
- [x] 1.3 Clean the two archived proposals (a private repo name and a home-directory string)
- [x] 1.4 Replace other-workspace ticket IDs in source, tests and archived changes
- [x] 1.5 Drop `docs/design/v2/uploads/*.md`; re-scan the tree for the listed terms and run `pnpm scan:secrets`

## 2. Community files
- [x] 2.1 CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, CHANGELOG, CODEOWNERS
- [x] 2.2 Issue templates and PR template; README points at CONTRIBUTING

## 3. Claims and fonts
- [x] 3.1 Self-host fonts with licences; verify zero external requests in the built UI
- [x] 3.2 Fix CLAUDE.md visual-contract sentence, `conductor` alias wording, HTTPS clone
- [x] 3.3 Align Node/pnpm across README, CI, mise.toml, Dockerfile
- [x] 3.4 Renumber ADRs 0012/0013 duplicates and update links

## 4. Verify and branches
- [x] 4.1 Lint, typecheck, both test suites
- [ ] 4.2 Prune-branches dry-run pasted in PR; delete after merge
