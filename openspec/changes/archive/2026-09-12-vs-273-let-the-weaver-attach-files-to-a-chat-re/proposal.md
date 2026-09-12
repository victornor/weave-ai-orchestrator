## Why

The weaver can only ever *tell* the human where files are, never hand them over: when captain asked for
a design handoff, the best it could do was name five files (two knowledge-base briefs, a design
contract, and `packages/ui/src/index.css`) and ask captain to go and collect them by hand. The
`attachments` table already has no direction constraint and already supports rendering a file in chat —
the entire gap is outbound: nothing lets an agent stage bytes onto its own reply.

## What Changes

- `ac_human_send` gains an optional `attachments` parameter: a list of up to four entries, each either
  a single file path or a group of paths to be bundled into one named zip.
- A new server-side path allowlist decides what the weaver may read for this purpose: the workspace's
  `knowledge/` tree, the `projects/` tree (every project's clone), and each worker's own `work/`
  worktree — resolved through `realpath` so a symlink cannot launder a disallowed path, and checked
  against an explicit allowlist rather than "anything under the workspace root", so the daemon's state
  directory (`secrets.enc`, `secrets.key`, the database, runtime credential homes), agent home
  directories, and anything outside the workspace are refused by construction, not by exclusion.
  A refused path is a named, loud error identifying exactly which path and why; nothing is written —
  no message, no attachment row, no zip — until every requested path has cleared validation.
  Workers do not get this parameter; only the weaver's reply path gains it.
- `application/zip` becomes a producible attachment type for outbound messages only — built
  server-side from validated file bytes using `node:zlib`'s raw-deflate and CRC32 support (already in
  Node 26; no new runtime dependency). It carries its own size cap, distinct from the existing
  image/text caps, and is never treated as an image for rendering purposes.
- The existing inbound-only accepted-type allowlist (`attachmentMaxBytes`, images and text, the
  multipart route, `ATTACHMENT_MAX_PER_MESSAGE`) is untouched: a human still cannot upload a zip, and
  nothing about what a human can attach changes.
- The chat UI's existing attachment gallery (`AttachmentGallery` in `Chat.tsx`, backed by
  `attachmentToView` in `packages/render`) already renders a non-image attachment as a filename+size
  download chip and is not keyed by message direction — it needs no change to display an outbound
  attachment or a zip; verified during apply, not assumed.

## Capabilities

### New Capabilities
- `conductor-chat/outbound-attachments`: lets the weaver attach one or more files, or a named zip
  bundling several, to a human-facing chat reply, bounded by a server-enforced path allowlist and its
  own size caps.

### Modified Capabilities
(none — inbound attachment behavior, caps, and the multipart route are explicitly out of scope and
unchanged)

## Impact

- `packages/shared/src/attachments.ts` — additive: a zip media type and its own cap constant, kept
  separate from `attachmentMaxBytes()` so the inbound route's behavior for zip stays "rejected", not
  "accepted with a new cap".
- `packages/shared/src/tools.ts` / `packages/server/src/tools.ts` — `ac_human_send`'s input schema and
  handler.
- `packages/core/src/threads/` — a new module resolving and validating outbound attachment paths
  (allowlist, size caps, zip assembly), and an extension to `ThreadsService.outbound()` to write
  attachment rows/files in the same transaction as the message, mirroring `inbound()`.
- `packages/ui` / `packages/render` — verification only, expected to need no code change.
- No database migration: `attachments.media_type` is already unconstrained `TEXT`, and the table
  already carries no direction constraint.
