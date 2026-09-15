# VS-456 — promoting the app to the root (review evidence)

Throwaway evidence from the **real** app, built with this branch and served by a **scratch daemon**
(`scripts/scratch-daemon.sh start --dir /tmp/opencode/vs456-daemon --port 7499`, never the live
one), with one registered workspace (`acme`, `/tmp/opencode/vs456-ws-acme`) holding one ticket
(`ACME-1`) and the bundled `examples/plugins/notes` plugin loaded. Driven in headless Chromium
(`/usr/bin/chromium`) through Playwright-core 1.63.0; the harness lived in
`/tmp/opencode/vs456-harness/` and is not committed. The daemon was stopped by its recorded PID
afterwards.

## Screens at the root URLs

Every shot opens a **root** address (no `/v2`), with the persisted theme applied. Zero console/page
errors on every shot (the one page error in `plugin.json` is the harness's own `addInitScript`
touching `localStorage` in the sandboxed plugin iframe — not the app).

| Shot | Theme | Address | Measured |
|---|---|---|---|
| `vs456-needs-dark.png` | dark | `/w/acme/needs` | rail + `Needs you`, `data-theme=dark` |
| `vs456-needs-light.png` | light | `/w/acme/needs` | same, `data-theme=light` |
| `vs456-chat-dark.png` | dark | `/w/acme/chat` | rail + `Acme` group, chat pane |
| `vs456-chat-light.png` | light | `/w/acme/chat` | same |
| `vs456-ticket-dark.png` | dark | `/w/acme/tickets/ACME-1` | ticket page for `ACME-1` |
| `vs456-ticket-light.png` | light | `/w/acme/tickets/ACME-1` | same |
| `vs456-plugin-notes-dark.png` | dark | `/w/acme/plugins/notes` | plugin iframe, `data-theme=dark`, `.v2-card` background `rgb(11,11,13)` |
| `vs456-plugin-notes-light.png` | light | `/w/acme/plugins/notes` | plugin iframe, `data-theme=light`, `.v2-card` background `rgb(255,255,255)` |

The plugin frames prove the page route still renders and the daemon-generated stylesheet still
themes it, following the host's live theme, after the route moved to `/w/:ws/plugins/:pluginId`.
`GET /api/w/acme/plugins/theme.css` returned `200`; the plugin's `GET /api/w/acme/plugins/notes/page`
returned `200`.

## Recorded old URL → final URL (real browser)

Each row is a fresh browser load of the old address; the table is `redirects.json`'s `redirects`,
produced by waiting for the router to settle and reading `location.pathname + location.search`.
Every row landed exactly on its target, query values preserved; 0 mismatches.

| Old address | Final address |
|---|---|
| `/v2/w/acme/work` | `/w/acme/work` |
| `/v2/runs?ws=acme` | `/runs?ws=acme` |
| `/w/acme/board` | `/w/acme/work` |
| `/w/acme/merge-queue?project=p1` | `/w/acme/work?project=p1` |
| `/w/acme/team` | `/w/acme/roles` |
| `/w/acme/live` | `/live?ws=acme` |
| `/w/acme/runs` | `/runs?ws=acme` |
| `/w/acme/runs/run_1` | `/runs/run_1` |
| `/w/acme/settings` | `/settings?scope=acme` |
| `/` | `/w/acme/needs` |

## PWA

`GET /manifest.webmanifest` has `start_url: "/"` and `scope: "/"` (unchanged); `GET /sw.js` returned
`200` with `SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg']` — path-agnostic,
and `notificationclick` opens the push payload's `path`, which `PushDispatcher` now builds as
`/w/<ws>/needs`. The daemon's SPA fallback serves the shell for `/`, the root page paths and every
retired path; a missing `/api/...` route still returns its own JSON 404 (covered by
`packages/server/test/static.test.ts`).
