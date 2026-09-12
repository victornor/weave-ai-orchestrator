## Context

See `proposal.md` — Why, for the motivating case. The relevant existing machinery, all inbound-only
today (verified by reading the code, not assumed):

- `attachments` (migration `0019_attachments.sql`): `id, thread_id, message_id, filename, media_type,
  byte_size, storage_key, created_at`. `media_type` is unconstrained `TEXT` — no CHECK constraint, no
  DB change needed. Rows are always written in the same transaction as the message that owns them.
- Bytes live at `ctx.paths.attachments` (`<state>/attachments`, outside anything `packages/ui`'s dist
  serves). `writeAttachment()` / `readAttachmentBytes()` / `sanitizeAttachmentFilename()`
  (`packages/core/src/threads/attachmentStorage.ts`) already do disk I/O with a server-generated
  `storage_key`, never the client's filename.
- `packages/shared/src/attachments.ts`: `attachmentMaxBytes()` returns a cap for the four accepted
  image types and two accepted text types, `null` for everything else — the inbound route
  (`packages/server/src/routes/threads.ts`, `sendWithAttachments()`) treats `null` as an outright
  rejection, all validation happening before `ThreadsService.inbound()` is called, so a rejected
  request stores nothing.
- `ThreadsService.inbound()` (`packages/core/src/threads/service.ts`) writes attachment rows/files
  inside the same `tx()` as the message insert. `ThreadsService.outbound()` — what `ac_human_send`
  calls — has no equivalent block today; it only forwards an opaque `opts.parts`.
- `ac_human_send` (`packages/server/src/tools.ts`): `{ threadId?, body, replyToMessageId? }`. No
  attachment parameter exists.
- `packages/render/src/attachments.ts`'s `attachmentToView()` classifies a part as `image` (inline
  thumbnail) only when its media type is in `ATTACHMENT_IMAGE_TYPES`, `text` or `other` otherwise —
  both of the latter already render identically today: a filename+size download chip
  (`AttachmentGallery` in `packages/ui/src/routes/Chat.tsx`). This component is not keyed by message
  direction, so an outbound `AttachmentPart` renders with zero UI changes once one exists.
- No zip capability exists anywhere in the repo or the lockfile (checked: no `archiver`, `jszip`,
  `adm-zip`, or similar, transitively or directly). Node 26 (this repo's runtime) ships
  `zlib.crc32()` and `zlib.deflateRawSync()`/`inflateRawSync()` — enough primitives to write a
  standard ZIP container without a new dependency; there is no ZIP *container* format built into
  `node:zlib` itself, only the compression primitives a container is built from.
- No existing helper does symlink-safe path-containment checking. The closest precedents:
  `packages/core/src/openspec/cli.ts`'s `samePath()` (uses `realpathSync` for an *equality* check,
  defending OpenSpec's root walk) and `packages/server/src/static.ts`'s `relPath()` (a string-prefix
  containment check, not symlink-safe, for serving static UI assets).

## Goals / Non-Goals

**Goals:**
- One atomic call attaches one file, or bundles several into one named zip, to a weaver reply.
- The set of paths a weaver may turn into an attachment is a small, explicit, symlink-safe allowlist —
  never "the workspace root minus some exclusions".
- Zero new runtime dependencies.

**Non-Goals:**
- Recursive directory attachment (a path naming a directory is refused, not walked).
- Any change to how a human uploads a file, the multipart route, or the image/text caps that govern it.
- Compression efficiency. The zip container uses the `store` method (no deflate) — see Decisions.
- Worker access to this tool, or any other outbound-attachment surface than `ac_human_send`.

## Decisions

### 1. Extend `ac_human_send` rather than add a separate staging tool

The ticket left this open. A separate `ac_attach_stage` + `ac_human_send` pair would let a stray second
call attach files to the wrong reply, or attach and then never send. A single call keeps "the message
and its attachments" atomic in exactly the sense the inbound path already is: validate everything, then
write the message and its attachment rows together in one transaction. The cost — a slightly larger
input schema on the one tool every reply calls — is small and optional (`attachments?`).

New input:
```
attachments?: Array<
  | { path: string }
  | { paths: string[]; zipName?: string }   // >= 1 path; bundled into one zip attachment
>
```
Capped at `ATTACHMENT_MAX_PER_MESSAGE` (existing constant, 4) total entries — a zip counts as one entry
regardless of how many paths it bundles, matching the existing one-entry-per-attachment-row model.

### 2. The allowlist is enumerated roots, symlink-resolved, never a root-minus-exclusions check

Three canonicalized roots, computed fresh per call (no caching — a workspace's project/worker set
changes at runtime):
- `realpath(ctx.paths.knowledge)`
- `realpath(ctx.paths.projects)`
- `realpath(join(ctx.paths.workers, <agentHomeDir>, 'work'))` for every entry currently under
  `ctx.paths.workers` (and, for symmetry with retired workers, under `ctx.paths.archive`) — computed
  structurally by listing the directory, not by querying the `agents` table, so a worker mid-retirement
  is not a race. Only the `work` subdirectory of each home is allowed, not the whole home (which can
  hold `AGENTS.md`, runtime config, or other material never meant to leave the box).

A candidate path is resolved with `realpathSync` (rejecting outright if the file does not exist or
cannot be `stat`ed) and then checked with `startsWith(root + sep)` (or exact equality) against every
canonicalized root above. This mirrors `openspec/cli.ts`'s `realpathSync` use (canonicalization) and
`static.ts`'s `startsWith` use (containment) but combines them into one check neither file does alone —
today nothing in the codebase resolves symlinks *and* checks containment against multiple roots.

Explicitly, by construction rather than by special-casing, this excludes: `ctx.paths.state` and
everything under it (`secrets.enc`, `secrets.key`, the sqlite db, `runtimesHome`, `attachments`
itself), `ctx.paths.weaver`, `ctx.paths.roles`, every worker home file outside its own `work/`, and
anything outside the workspace root entirely (the daemon's own config directory, `/etc`, the operator's
home directory). None of these are "under the workspace root minus an exclusion list" — they are
simply never in the three-root allowlist, so a future new root-level directory does not silently become
attachable the way it would under a denylist.

**Alternative considered:** allow anything under `ctx.paths.root` except a denylist of `state`,
`weaver`, `roles`. Rejected: a denylist must be updated every time a new root-level directory is added
to the workspace layout, and a missed update is a silent widening of what the weaver can exfiltrate.
An allowlist's failure mode is the opposite and safer one: a legitimate new location is refused loudly
until someone adds it.

**`.git` is excluded even inside an allowed root** (added after plan review). `projects/` and every
worker's `work/` are git clones/worktrees; allowing the root wholesale makes `<clone>/.git/config`
attachable, and that file carries the remote URL verbatim — harmless for this workspace's SSH remote,
but a credential leak for an HTTPS-token remote — and `.git/` also holds the full object store. The
containment check therefore rejects any candidate path with a `.git` path segment (`.../.git` itself,
and anything under `.../.git/...`) as a validation failure naming the path, in the same pre-read pass
as the root-containment check — not a silent skip, and not deferred to zip-build time.

### 3. Validate every path fully before writing anything

`resolveOutboundAttachments(ctx, entries)` (new, in `packages/core/src/threads/`) performs, for every
path in every entry, in order: allowlist containment → `statSync` is a regular file → size cap. Only
once every path in the whole request has passed does it read bytes and build the zip(s). This function
returns plain `{ filename, mediaType, bytes }[]` — the same shape `inbound()` already produces from its
own validation step — so `outbound()` can grow the identical "write attachment rows/files inside the
message's transaction" block `inbound()` already has, rather than inventing a second write path.
A failure anywhere throws a named `OcError('validation', ...)` identifying the specific path before any
attachment row, file, or the message itself is written — matching the inbound route's existing
guarantee that a rejected request stores nothing.

### 4. Zip is hand-built from `node:zlib` primitives, using `store` (uncompressed) entries

No new dependency: Node 26's `node:zlib` exposes `crc32()` and raw deflate, which is everything a ZIP
*writer* needs — but entries are written with compression method `0` (store), not `8` (deflate).
Store is a fixed-format copy of the input bytes plus its CRC-32 and lengths; every ZIP reader
(Explorer, Archive Utility, `unzip`, any language's zip library) supports it unconditionally, and it
removes an entire class of bug (getting deflate's raw-stream framing or the local/central "compressed
size" bookkeeping wrong) for a feature whose inputs are already size-capped, mostly-text handoff files
where the compression win is small. The container itself (local file header, central directory, end-of-
central-directory record) is a well-specified, testable binary layout; the implementation is verified
in `apply` against both a manual byte-level parse and, where the test environment has it, a real
`unzip -l`/`unzip -p` round trip — not against a hand-written fixture guessing what a zip "looks like".

**Alternative considered:** add `yazl` or `archiver` (small, focused zip-writing libraries). Rejected
per the ticket's instruction to check what already exists first — `node:zlib` already supplies every
primitive a `store`-only writer needs, so a new dependency buys nothing here. If deflate compression is
wanted later, that is a separate, additive change to the same writer.

### 5. Outbound media type is guessed from the extension, not asserted by the caller

The weaver does not declare a media type (unlike the inbound multipart route, where the human's browser
does and the server verifies it). For a single-file entry, the extension is looked up in a small,
explicit map covering exactly the types `packages/render` already classifies specially
(`png/jpg/jpeg/gif/webp` → the existing image types, `txt/md` → the existing text types); anything else
defaults to `application/octet-stream`. This is deliberately reused, not reinvented: a `.png` read from
`knowledge/` renders as an inline thumbnail exactly like an inbound one, because it lands on the same
`ATTACHMENT_IMAGE_TYPES` classification `attachmentToView()` already checks — no UI change, and no new
classification rule to maintain. Everything else — including every zip — renders as the existing
`other`-kind download chip. `attachmentMaxBytes()` and the inbound accepted-type list are untouched:
this mapping lives beside it in `packages/shared/src/attachments.ts` as a separate, additive export
used only by the outbound path, so a human still cannot upload a zip through the multipart route.

### 6. Outbound size caps are new constants, independent of the inbound image/text caps

`ATTACHMENT_MAX_OUTBOUND_FILE_BYTES` (single file, outbound) and `ATTACHMENT_MAX_ZIP_INPUT_BYTES`
(combined input to one zip, before the `store` container's small fixed overhead per entry) are new,
separate from `ATTACHMENT_MAX_IMAGE_BYTES`/`ATTACHMENT_MAX_TEXT_BYTES`. Those two exist for a different
reason (reverse-engineered from the installed Claude CLI's own paste-image limit, and a context-budget
bound on inlined text) that does not apply to a file the weaver already read off disk. Reusing them
would either be needlessly small for a text handoff bundle or accidentally wrong for an image. Proposed
values: 10 MiB per file, 40 MiB combined zip input — generous enough for the motivating case (a design
contract, two briefs, and a stylesheet) with headroom, while still bounding the daemon's memory use for
a feature that reads everything into memory before writing (no streaming — see Risks).

### 7. Zip naming and internal paths

Default zip filename (when the weaver does not supply one): `weaver-attachments-<UTC compact
timestamp>.zip` — identifies it as a weaver handoff, per the spec's requirement, without depending on
any per-request context that might not exist (no ticket, no project). A supplied name is sanitized the
same way an inbound filename is (`sanitizeAttachmentFilename`) and a trailing `.zip` is appended if
missing.

Inside the zip, each entry's internal path starts as its `basename`. On a collision with an already-
added entry, it is re-prefixed with its immediate parent directory's name (`<parentDirName>/<base>`);
if that still collides, a numeric suffix (`-2`, `-3`, …) is appended before the extension. This keeps
the common case (a handful of files from unrelated directories) flat and readable, per the acceptance
criterion that a zip must open "with those files at sensible paths inside it".

## Risks / Trade-offs

- **[Risk]** A hand-built ZIP writer could produce a container some real-world tool fails to open,
  despite passing an in-process test. → **Mitigation**: `store`-only entries (Decision 4) instead of
  deflate, which is the simplest correct subset of the format; the apply-phase test suite verifies the
  output both by parsing the central directory manually and, when `unzip` is present in the test
  environment, by an actual `unzip -l`/`unzip -p` round trip rather than trusting the writer's own
  idea of its output.
- **[Risk]** Everything is read fully into memory (a file, or all of a zip's inputs) before any bytes
  are written. → **Mitigation**: the size caps (Decision 6) bound this to at most ~40MB per request,
  consistent with the existing inbound route's own pre-`formData()` memory-exhaustion guard.
- **[Risk]** Listing `ctx.paths.workers`/`ctx.paths.archive` on every call to build the worktree
  allowlist adds a filesystem walk to every reply that carries an attachment. → **Mitigation**: bounded
  by the number of workers a workspace actually has (typically single digits to low tens), and only
  runs when the `attachments` parameter is present at all.
- **[Trade-off]** No compression means a zip of already-small text/code files is not meaningfully
  smaller than the sum of its parts. Accepted: correctness and dependency-freedom over download size,
  for a feature whose inputs are capped small anyway.

## Migration Plan

Additive only — no migration. New exported constants and one new module in `packages/core/src/threads/`;
`ac_human_send`'s new parameter is optional, so every existing caller and every existing test of the
unchanged path continues to pass unmodified. Nothing is removed or renamed.
