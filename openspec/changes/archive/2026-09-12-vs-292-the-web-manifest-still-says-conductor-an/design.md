# Design

## Context

`packages/ui/public/manifest.webmanifest` is a single 16-line JSON document served statically. VS-286's
scout found two stale fields in it; both are one-line edits with no behavioural coupling.

## Goals / Non-Goals

**Goals:**

- `short_name` names the shipped product (`Weave`).
- No orientation lock imposed by the manifest.
- Keep the document valid JSON and installable (the scout saw
  `Page.getInstallabilityErrors` return `[]` against `main`; that must not regress).

**Non-Goals:**

- Any change to the icons, the service worker, or anything else under `packages/ui/public/`.
- Any other rename leftover; those are listed for filing, not swept in.
- Inventing a spec requirement for manifest strings.

## Decisions

**1. `short_name: "Weave"`, not `"Weave AI"`.** `name` stays `"Weave AI"` (the full product name);
`short_name` is the launcher label and is meant to be the short form. "Weave" is that short form and
is the word the product mark and the CLI carry. Alternative — `"Weave AI"` in both — loses the point
of having a distinct short name and is more than a launcher will show.

**2. Remove `orientation` rather than flip it to `any` or `landscape`.** The ticket asks for removal
"so the platform decides". `orientation: "any"` is the explicit spelling of the same intent but adds a
key that has to be understood; absence is the default and the smallest surface. No code, CSS or
screenshot references a portrait assumption that a lock was protecting (see the orientation check in
`proposal.md`), so nothing depends on it staying.

## Risks / Trade-offs

- A phone install that previously stayed upright can now rotate. That is the intended behaviour of
  "the platform decides", and the app is responsive and already handles `orientationchange`
  (`packages/ui/src/lib/viewport.ts`), so this is a behaviour change the layout is built for.
- Removing a manifest field cannot affect installability: installability criteria are `name`/
  `short_name`, icons, `start_url`, `display` and a service worker, none of which change.
