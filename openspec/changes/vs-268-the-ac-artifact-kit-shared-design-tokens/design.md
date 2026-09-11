## Context

`packages/ui/src/index.css` is the only place AC's design tokens are authored today: CSS custom
properties consumed through Tailwind v4's `@theme` mapping, built by Vite. The server
(`packages/core`, `packages/server`) is plain `tsc`, no bundler, no CSS asset imports — it cannot
`import` a `.css` file and get a string out of it. A static HTML artifact rendered from disk (no
build step, `file://` or a sandboxed iframe) needs the tokens as literal CSS text it can inline or
link, not as a Tailwind build artifact.

This ticket covers only the part of captain's artifacts specification (full text on VS-268's first
comment) that doesn't depend on where an artifact is ultimately stored: the kit, the skill, and the
on-demand tool. See `proposal.md` for what is explicitly out of scope.

## Goals / Non-Goals

**Goals**
- One CSS token source of truth; the kit is a derived, drift-checked copy, not a hand-kept twin.
- The kit is usable by pasting its CSS text into an HTML `<style>` or linking it locally — nothing
  else required.
- The tool and the skill share one body of guidance; the tool doesn't fork a second copy of the
  playbooks.

**Non-goals**
- Storage, authoring tool (`ac_ticket_artifact_put`), serve route, CSP, or viewer — second ticket.
- Matching `packages/ui`'s component CSS (`.ac-card`, `.ac-panel`, … in `index.css`'s
  `@layer components`) byte-for-byte. Those rules assume a Tailwind build (layers, `@theme`-derived
  utilities elsewhere on the same element) that a static kit doesn't have. Only the **token layer**
  is single-sourced and drift-tested; the kit's semantic component layer is authored once, for the
  static-document case specifically (see Decision 3).

## Decisions

### 1. Kit location: `packages/core/src/artifacts/kit.ts`

`packages/core` already holds the daemon's cross-cutting brain (tickets, knowledge, specs, openspec)
and is imported by `packages/server`; `packages/server` is where the tool handler lives. Per
`scripts/guard-boundaries.mjs`, `core` may not import `ui`, `server`, or any runtime/channel/surface
package — but nothing here needs it to: `kit.ts` exports a plain string and some data, no import of
`@agent-conductor/ui` involved. This keeps the CSS text one hop from the tool handler and doesn't
create a new package for ~200 lines of CSS and a handful of TS objects. Rejected: a new
`packages/artifacts` package (unnecessary ceremony for this size); `packages/shared` (the SDKs and
`shared` itself must stay free of anything import-only-useful-to-the-server; `core` is already the
home for daemon-only cross-cutting concerns and does not have `shared`'s "importable by everything"
contract).

### 2. Token scope: an explicit allowlist, not "everything in `index.css`"

`index.css` also carries tokens that are actively wrong to promise in an offline static document:
viewport tokens driven by JS (`--ac-app-h`, `--ac-safe-bottom`, …), the app's own chrome dimensions
(`--bar-height`, `--rail-width`, `--thumb-band`, `--banner-height`), and QR-specific tokens. Promising
those in the kit would either be dead weight or actively misleading (a `--bar-inset` nobody's JS ever
sets). The kit's token scope is a fixed, named allowlist — this is also what makes the drift test
precise rather than "fails on any future unrelated token":

- **Dark/light theme-dependent** (from the `:root, [data-theme='dark']` block and its
  `[data-theme='light']` override): `--bg-0` `--bg-1` `--bg-2` `--bg-3` `--bg-input` `--line-1`
  `--line-2` `--line-3` `--text-1` `--text-2` `--text-3` `--text-4` `--text-strong` `--text-soft`
  `--text-body` `--text-nav` `--accent` `--accent-link` `--accent-hover` `--accent-on`
  `--accent-tint` `--accent-tint-strong` `--accent-edge` `--focus-ring` `--overlay` `--elev-sheet`
  `--elev-float`, and the nine status tokens `--status-idle` `--status-working` `--status-stalled`
  `--status-blocked` `--status-needs-you` `--status-merging` `--status-done` `--status-failed`
  `--status-paused`.
- **Theme-independent scale** (from the theme-independent `:root` block): `--space-1`..`--space-9`,
  `--r4` `--r6` `--r8` `--r10` `--r-pill` `--r-device`, `--ff-ui` `--ff-mono`, `--fs-display`
  `--fs-title` `--fs-head` `--fs-body` `--fs-ui` `--fs-meta` `--fs-micro` `--fs-nano`, `--track-display`
  `--track-title` `--track-head` `--track-micro` `--track-label` (needed by the label/badge
  component), `--dur-fast` `--ease` (a purely-CSS hover transition on `.btn`/`.badge` needs no JS).
- **Explicitly excluded**: `--project-*` (nav project-identity colors, not needed to render a
  document), all viewport/keyboard/chrome-dimension tokens, `--qr-*`, `--dur-panel`/`--dur-max`
  (panel/sheet motion the kit has no panels or sheets to apply it to).

`--project-*` is the one exclusion someone might reasonably expect included; the acceptance
criterion is drift-safety for what the kit actually ships, so leaving it out entirely (not shipping a
half-maintained copy) is safer than a copy nobody remembers to update. If a future artifact needs
project-identity colors, that is a new, deliberate addition to the allowlist, not a silent gap.

### 3. Drift test: parse both sources, compare the allowlisted names

The test (`packages/core/src/artifacts/kit.test.ts`) parses CSS custom-property declarations
(`--name: value;`) out of three text regions in `packages/ui/src/index.css` (the dark block, the
`[data-theme='light']` block, the theme-independent `:root` block) and out of `ARTIFACT_KIT_CSS`'s
equivalent three regions, using one small regex-based parser (no CSS parser dependency — the
declarations are flat `--x: y;` lines, not nested selectors). It asserts, for every name in Decision
2's allowlist, that the value parsed from `index.css` equals the value parsed from the kit, in each
of the three regions. It also demonstrates the failure it's meant to catch: a second test case that
mutates one parsed value in memory before comparing, asserting the comparison now fails — proving the
assertion actually discriminates rather than vacuously passing (e.g. because a regex matched nothing).
Reads `packages/ui/src/index.css` via a relative filesystem path from the test file
(`../../../ui/src/index.css`) — a plain `fs.readFileSync`, not a module import, so it does not trip
`guard-boundaries.mjs` (which only inspects `from '...'` import specifiers) and does not create a
build-order dependency between the two packages.

### 4. Components and layout-safety rules: hand-authored once, using the tokens

Per the ticket's content list: base layer (page background/text, fonts, `box-sizing: border-box`,
focus ring, `::selection`), layout-safety rules (`min-width: 0` on grid/flex children,
`overflow-wrap: anywhere` on prose/table/badge/label, `max-width: 100%` on media), and a semantic
class layer: `.page`, `.section`, `.card`, `.panel`, `.btn`, `.badge`/`.status-*` (nine color
variants keyed to the status tokens), `.table`, `.code`/`.kbd`, `.steps`/`.timeline`. These are new
CSS rules written directly against the token custom properties (`var(--bg-1)`, `var(--r6)`, …), not
copies of anything in `index.css`'s Tailwind-layered `@layer components` (which assumes utilities
from elsewhere on the same element that a static document doesn't have). Not drift-tested — only the
token layer is (Decision 2/3) — because there is nothing in the app to drift against: the app has no
equivalent "single HTML document, no Tailwind" component layer.

### 5. Playbooks: the tool reads the skill's own reference files, not a second copy

`ac_artifact_kit`'s `playbooks` field is produced by reading
`skills/agent-conductor-artifacts/references/*.md` off disk at call time (one string per file, keyed
by filename stem), mirroring `packages/core/src/workers/home.ts`'s existing pattern of reading
`ctx.skillsDir` at runtime (same `WorkspaceContext.skillsDir` field, same missing-directory-returns-
empty behavior). This is the single source for playbook text: the skill file an agent reads directly
and the tool result are the same bytes, so they cannot drift apart the way a hand-duplicated second
copy could. `kit.ts` exports a `readArtifactPlaybooks(skillsDir: string): Record<string, string>`
function taking the directory as a parameter (not importing anything workspace-shaped), keeping
`packages/core` boundary-clean; the tool handler in `packages/server/src/tools.ts` supplies
`ctx.ws.ctx.skillsDir`.

`components` is a small hand-written array (`{ className, description }[]`) describing the semantic
layer from Decision 4 — there's no file to read it from; it's documentation of CSS this same change
adds. `tokens` is the parsed allowlisted token map from Decision 2/3 (`{ dark, light, scale }`),
reusing the drift test's parser so the tool result and the test's notion of "the token set" are the
same code path, not two.

### 6. Tool contract

`ac_artifact_kit()`, no input, `scope: 'all'`, registered in `COMMON_TOOLS`
(`packages/shared/src/tools.ts`) and as a `ToolDef` in `packages/server/src/tools.ts` (same pattern as
`ac_worktree_status`: `input: z.object({})`). Returns
`{ css: string, tokens: { dark: Record<string,string>, light: Record<string,string>, scale:
Record<string,string> }, components: { className: string, description: string }[], playbooks:
Record<string,string> }`. No DB read, no scoping — every agent gets the same result. Documented in
`docs/PLAN.md` §9.2's "Common (all agents)" list.

## Risks / Trade-offs

- **[Risk]** The allowlist (Decision 2) could omit a token a future component needs, forcing a
  follow-up edit to both `kit.ts` and the test's allowlist. → **Mitigation**: the allowlist lives as a
  single exported constant in `kit.ts`, so extending it is a one-line, drift-test-guarded change, not
  a rediscovery.
- **[Risk]** Reading skill files off disk at request time (Decision 5) means a workspace whose
  `skillsDir` doesn't have `agent-conductor-artifacts` installed (a misconfigured `AC_SKILLS_DIR`,
  or a very old release) gets an empty `playbooks` object instead of an error. → **Mitigation**: this
  matches `home.ts`'s existing behavior for the same situation (empty list, not a throw); the kit's
  `css`/`tokens`/`components` — which don't depend on disk state at call time — are unaffected, so a
  broken skill install degrades the tool's usefulness rather than breaking it.
- **[Trade-off]** The kit's component layer (Decision 4) is a second, independent CSS surface from
  `index.css`'s component layer, so a future visual change to `.ac-card` in the app does not
  propagate to artifacts and vice versa. Accepted: the acceptance criteria and the drift test are
  explicitly scoped to tokens, not components; making components single-sourced too would require the
  app's Tailwind-dependent component rules to become build-free, which is out of scope here.

## Migration Plan

Additive only — new files, new tool, new skill. No migration, no existing behavior changes.

## Open Questions

None that would change the specs, the approach, or the task breakdown. (The storage question raised
on the ticket is explicitly out of scope for this change — see `proposal.md`.)
