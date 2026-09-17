# VS-494 — the restored "Send automatically when dictation ends" switch

Rendered evidence for the Settings → Dictation switch restored by VS-494, in dark and light. The
switch is the only UI for the preference the dictation keybinding now honours; VS-489 had removed it.

## How they were made

Throwaway harness in `/tmp` (not committed): a Vite dev server serving the worktree source with the
real `DictationSection` from `packages/ui/src` under Tailwind v4 and a `QueryClientProvider`, mounted
in a `.v2-root` with `data-theme` set to `dark` or `light`. Headless Chromium
(`/usr/bin/chromium --headless=new`), viewport 880×760 at 2×. No daemon was reached: the
transcription queries fail and the section falls back to its defaults (`chrome`, Voxtype not
installed), which is exactly the state shown. Nothing from the live install was touched.

## What each capture shows

| File | Shows |
|---|---|
| `vs494-switch-dark.png` | the Dictation section on `data-theme=dark`, with the "Send automatically when dictation ends" card and its switch off |
| `vs494-switch-light.png` | the same section on `data-theme=light` |

Both open correctly and show the switch **off** (grey knob to the left), labelled "Send
automatically when dictation ends", with the corrected description: ending a dictation with the
keyboard shortcut sends the whole draft once the transcript lands, while the mic and Stop always
leave the text in the composer, stored in the browser.

## Unit coverage

`packages/ui/src/test/dictationAutoSendSetting.test.tsx` renders the same section and asserts the
switch starts off, toggles on (writing `conductor.dictationAutoSend = 'on'`), toggles back off, and
reads a preference stored before the setting was retired. The behaviour it drives is covered in
`dictation.test.tsx`, `v2chatcomposer.test.tsx` and `v2dictationsession.test.tsx`.
