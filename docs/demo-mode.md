# Demo mode and marketing screenshots

Demo mode starts a complete Weave AI daemon on made-up data, with nothing real behind it: no coding
CLI, no git remote, no forge, no network. It exists so product screenshots can be captured the same
way every time.

## Start one

```
pnpm build                                   # once: the demo serves the built UI
node packages/server/dist/bin.js --demo      # or: pnpm demo
```

Options (all optional):

| Flag | Default | Meaning |
|---|---|---|
| `--config-dir DIR` | a fresh directory under the system temp dir | Where the demo keeps its database, workspaces and repositories. Must be empty, or an earlier demo's (it carries a `.weave-demo` marker and is wiped and reseeded). |
| `--port N` | a free loopback port | The demo listens on `127.0.0.1` only. |

It prints the URL when it is ready. Open it in a browser; there is no login (the demo trusts loopback).

**What it refuses.** Port `7433` (the live daemon's), the live config directory (`~/.config/weave`,
`~/.config/agent-conductor`, or `AC_CONFIG_HOME`), and any non-empty directory that did not come from
a demo. These checks run before anything is created.

**Stopping it.** Send `SIGTERM` to the process you started, by its pid. Never `pkill` by name: the live
daemon runs the same `packages/server/dist/bin.js`.

## What is in it

A fictional company, **Lumen Labs**, with three projects (Storefront, Ledger API, Pocket App), seven
roles, and 24 tickets: every status (backlog through done and cancelled) and every kind (change, task,
scout, question, operational). There are workers running, idle, paused and errored; plan, merge,
action, hire and promotion approvals, unseen, reviewed and held, plus questions with options and inputs;
a conversation with the weaver; runs with transcripts; 30 days of usage; incidents; scheduled tasks; a
roadmap; a knowledge base with a link graph; specs; a merge queue. A second workspace, **Fernwood
Studio**, gives the workspace switcher somewhere to go.

Each project is a small real git repository built locally from fixed dates and invented authors, so the
project pages, changelog and specs index read real git. Nothing is ever fetched or pushed anywhere.

The "live" views move. The demo registers no real runtime, so a scripted player (`src/demo/script.ts`)
appends the next event to every seeded running run every 1.5 seconds. Each project has a script that
fits its story.

## It is reproducible

* Every id is derived from a label (`demoId`), never random.
* Every timestamp is a fixed offset from `2026-03-02T14:30:00Z`. The demo process also runs on that
  clock (it starts at that instant and then ticks), so the server's own windows ("last 7 days") agree
  with the data. The capture script gives the browser the same clock.
* The generated figures (usage, run sizes) come from a seeded generator.
* The seed is tested: two seeds into empty databases are byte-identical
  (`packages/server/src/demo/seed.test.ts`).

## Capture screenshots

```
pnpm build
pnpm demo:screenshots                         # all views, desktop and phone, light and dark
pnpm demo:screenshots --out ~/shots --only chat,usage --viewport phone --theme dark
pnpm demo:screenshots --url http://127.0.0.1:7500   # capture a demo you already started
```

With no `--url` it starts its own demo daemon on a free port in a throwaway directory, records the pid,
captures, and stops exactly that pid. Files are named `<name>--<viewport>--<theme>.png`, for example
`ticket-merge-review--phone--dark.png`. The default output folder is `demo-screenshots/` (git-ignored).

Chromium comes from `CHROME_PATH` if set, else Playwright's own download (`npx playwright-core install
chromium`), else a system `chromium` or `google-chrome`. Desktop is 1440x900; phone is 390x844 at 2x.

The command exits non-zero if any page logs a console or page error or a request fails, and says which.

## Add a view

Add an entry to `SHOTS` in `packages/server/src/demo/manifest.ts`:

```ts
{ name: 'ticket-merge-review', path: '/w/{ws}/tickets/LUM-3' },
```

`{ws}` is the primary workspace. Optional fields: `ready` (a selector to wait for), `settleMs` (extra
time for things that lay themselves out), `viewports`, `fullPage`, `click` (selectors to click first,
for example to zoom a map), and `blockStreams` (fail the live streams so the connection banner shows).
The capture script, the route test and this document all read that one list. If the view needs data the
seed lacks, add it in `src/demo/seed.ts` and keep ids label-derived (`id('thing:key')`).

## Where things live

| File | What |
|---|---|
| `src/demo/index.ts` | `startDemo`, the safety checks, directory preparation |
| `src/demo/seed.ts`, `seedFernwood.ts`, `content.ts` | the data, and the words |
| `src/demo/clones.ts` | the local git repositories |
| `src/demo/knowledge.ts` | knowledge pages, written through the knowledge service |
| `src/demo/adapters.ts`, `script.ts` | the pretend runtime and forge, the live-progress player |
| `src/demo/manifest.ts`, `capture.ts`, `scripts/demo-screenshots.mjs` | the screenshots |

All under `packages/server/`.
