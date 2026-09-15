# Tasks

- [x] 1. Add the two hand-authored rules to `generateV2PluginCss` in `packages/core/src/artifacts/v2-theme.ts`: `[hidden] { display: none !important; }` and `body > * + * { margin-top: var(--space-6); }`, with a comment naming the gap each closes.
- [x] 2. Extend `packages/core/src/artifacts/v2-theme.test.ts`: assert both rules are present and that the `[hidden]` rule is `display: none !important` (so it beats the vocabulary's non-important `display` recipes).
- [x] 3. Update `examples/plugins/notes/index.js` to render two stacked sections and a form row toggled through the `hidden` attribute.
- [x] 4. Document the page stack and `[hidden]` behaviour in `docs/PLUGINS.md`.
- [x] 5. Capture rendered evidence: the notes page in the V2 frame, dark and light, with a bordered gap between the sections and the hidden row gone (computed `display: none`).
- [x] 6. Checks green: `pnpm lint`, `pnpm typecheck`, `pnpm test`; PR open and recorded.
