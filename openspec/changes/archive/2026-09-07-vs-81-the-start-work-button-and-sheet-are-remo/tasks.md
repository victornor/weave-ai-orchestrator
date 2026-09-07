# Tasks

- [x] 1. Delete `StartWorkSheet.tsx` and unwire it from `AppShell`: the rail button, the `startOpen` state, the `⌘⇧Space` hotkey and the `BottomBar` prop.
- [x] 2. Point the palette's "Create ticket" at the conductor chat.
- [x] 3. Drop the floating button from `BottomBar` and the button's geometry from `barGeometry`; give the tab row the bar's own padding and centre each tab's content in what is left.
- [x] 4. Fold the sheet's example prompts and mic hint into the chat's empty state.
- [x] 5. Update the tests: `bottombar.test.tsx` loses the button's geometry cases and gains a pin that no Start Work control is rendered; `appshell.test.tsx` loses the sheet mock and gains a pin on the rail and the palette.
- [x] 6. Update `DESIGN-CONTRACT.md` §3 and §7, `PLAN.md` §20/§21.1 and `SCENARIOS.md` where they describe Start Work.
- [ ] 7. `pnpm typecheck`, `pnpm lint`, `pnpm test`; screenshots of the desktop rail and the phone layout without the button.
