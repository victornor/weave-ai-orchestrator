## 1. Implementation

- [x] 1.1 Add `listenWithWait` and use it from `listen` in `packages/server/src/daemon.ts`; add `StartOptions.listenWait`
- [x] 1.2 Tests: delayed availability (one start, no failed-start record), never available (fails after bound with EADDRNOTAVAIL), `EADDRINUSE` fails fast
- [x] 1.3 Run lint and both test suites; paste both blocks
