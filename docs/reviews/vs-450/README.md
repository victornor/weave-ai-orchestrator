# VS-450 — the V2 floating dictation bar (review evidence)

Real-browser captures of the **real V2 app** — `V2Shell`, the Work board and the Chat screen — in
dark and light, at desktop (1440×900) and phone (390×844) width.

## How they were made

Throwaway harness (files in `/tmp`, not committed): the Vite dev server serves `packages/ui` from
source with `AC_DAEMON_URL` pointed at a **dead port**, and an init script stubs `window.fetch` for
`/api/*` and `window.EventSource`. No daemon is contacted; the live daemon and port 7433 are
untouched. Headless Chromium (Playwright-core, `/usr/bin/chromium`) is launched with
`--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`, and `/api/transcribe` is stubbed
with a ~2.6s delay, so the **real** `useDictation`/`DictationSessionProvider` session records from
the fake mic and transcribes for real. Only the daemon API and the microphone are faked; every V2
component is the shipping one.

Two scenes per theme/width, in separate pages:

1. **listen / transcribe** — open `/v2/w/acme/chat`, start dictation with the mic, navigate to the
   real Work page (the session survives), capture; Stop and capture mid-transcription.
2. **sent** — a fresh page: start dictation, navigate to Work, Send from the bar (stop, wait for the
   transcript, post), then the Chat screen with the delivered message.

The harness fails if the error boundary (`UNKNOWN_ERROR` / `Retry`) is on screen at any capture, or
if the posted body is not the transcript exactly once.

## Measured on the page

| Scene | Theme | URL | Bar vs nav | Content |
|---|---|---|---|---|
| listening, desktop | dark/light | `/v2/w/acme/work` | nav hidden | board renders; page ends above the bar |
| listening, phone | dark/light | `/v2/w/acme/work` | overlap 0px, 8px gap above the tab bar | board renders; page ends above the bar |
| transcribing, phone | dark/light | `/v2/w/acme/work` | overlap 0px, 8px gap | page ends above the bar |
| sent | dark/light | `/v2/w/acme/chat` | bar absent on the target chat | the message appears exactly once |

- The Work board renders real cards in every capture (see the note below on the earlier error).
- `.v2-root` carries the theme and the whole page follows it (body `rgb(5,5,6)` dark /
  `rgb(247,248,249)` light, header and rail included).
- The bar clears the phone tab bar by 8px (no overlap), and the routed page reserves room for the
  bar, so its content ends above it on both widths.
- Zero console errors in every scene.

## Notes

- An earlier capture showed `UNKNOWN_ERROR · reading 'status'` in the Work area. That was the
  harness's stub data: a seeded ticket used `status: 'needs_you'`, which is not a `TicketStatus`, so
  `V2_STATUS_COLUMN[status]` was undefined and the board threw. Fixed in the stub; VS-450 was not at
  fault, and the harness now fails loudly on any error boundary.
- An earlier `sent` capture showed the transcript twice. That was the harness running two dictation
  sessions into the same draft (the second appends to the first). The fixed harness uses one session
  per fresh page; the run asserts the posted body equals the transcript exactly once, and
  `v2dictationsession.test.tsx` covers both the off-chat bar send and the on-chat composer send.
- `V2Shell` adds `pb-[8.5rem] md:pb-20` to the routed page while the bar is visible (`barVisible` on
  the session), on top of the tab bar's own clearance.

## Captures

| state | files |
|---|---|
| listening on Work | `vs450-listen-{desktop,phone}-{dark,light}.png` |
| transcribing on Work | `vs450-transcribe-{desktop,phone}-{dark,light}.png` |
| chat after send | `vs450-sent-{desktop,phone}-{dark,light}.png` |