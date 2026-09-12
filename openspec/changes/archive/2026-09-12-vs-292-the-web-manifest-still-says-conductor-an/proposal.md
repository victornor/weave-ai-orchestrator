# The web manifest still says Conductor and pins portrait orientation

Tracker change for [VS-292](conductor://tickets/VS-292). A `task` ticket, so this change carries
tasks only — `skip_specs: true`.

## Why

Two leftovers in `packages/ui/public/manifest.webmanifest`, both found by VS-286's desktop-app scout
and filed rather than fixed:

- `"short_name": "Conductor"` — VS-260's rename swept `name` and missed this one. A launcher and a
  home-screen icon label the app from `short_name`, so the old product name is what a person sees
  under the icon. It is wrong today on every installed surface.
- `"orientation": "portrait-primary"` — a phone constraint in an app we also install on desktops.
  Desktop Chromium ignores it, so it is wrong rather than broken: it silently denies landscape to a
  phone install and would deny it to a future desktop install that honoured it.

## What Changes

- `short_name` reads `Weave`.
- The `orientation` key is removed so the platform decides.
- Nothing else. Icons, the service worker and every other file under `packages/ui/public/` stay
  untouched, and no other rename leftover is swept in.

## Capabilities

None. The manifest's contents are not a stated requirement anywhere under `openspec/specs/` — a spec
would have to invent a requirement about product-name strings and a viewport lock. `skip_specs: true`
is set in `.openspec.yaml`.

## Impact

- `packages/ui/public/manifest.webmanifest` — two keys changed.
- No code, route, config, dependency or build change. Consumers (`packages/ui/index.html`) reference
  the file by name and are untouched.

## Orientation check (recorded here, repeated in the report)

Nothing in the app assumes a portrait viewport. The only `orientation` references are
`aria-orientation` on two accessible controls (`Chat.tsx`, `KnowledgeExplorer.tsx`) and the
`orientationchange` listener in `packages/ui/src/lib/viewport.ts`, which exists to re-measure the
keyboard insets after a rotation — it anticipates both orientations rather than requiring one. There
is no `screen.orientation` lock, no `matchMedia('(orientation: …)')`, and no portrait-only layout
branch. Removing the manifest key is safe.
