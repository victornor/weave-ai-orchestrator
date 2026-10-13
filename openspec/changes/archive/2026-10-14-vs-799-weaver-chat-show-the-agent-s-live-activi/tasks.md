## 1. Default on

- [x] 1.1 Make `readShowLiveRunOutput` return true unless the stored value is `'off'` (including when localStorage throws); update its doc comment
- [x] 1.2 Update the Settings "Live weaver output" description in `settings/sections.tsx` for the on-by-default behaviour

## 2. Tests and verification

- [x] 2.1 Update `liveRunPrefs.test.ts` and `v2chat.test.tsx` (default on, explicit off hides the live section, live section gone once the final message arrives)
- [x] 2.2 Run both vitest suites and attach a screenshot of the weaver chat mid-turn showing tool calls
