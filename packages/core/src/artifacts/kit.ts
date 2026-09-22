/**
 * The AC Artifact Kit — a small, prebuilt, dependency-free CSS kit so a self-contained HTML
 * artifact looks like Weave AI. `openspec/specs/artifact-kit/design-tokens`.
 *
 * The token block below is a scoped, hand-kept copy of `packages/ui/src/index.css`'s dark/light
 * theme tokens and theme-independent scale — see `ARTIFACT_KIT_TOKEN_NAMES` for exactly which
 * tokens are in scope and why (viewport/chrome/QR tokens are deliberately excluded: they are
 * either JS-driven or describe app chrome an artifact never has). `kit.test.ts` fails the moment
 * this copy and `index.css` disagree on any allowlisted token.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { extractCssBlock, parseCssCustomProperties } from './parse.js';

/** Marker substrings `kit.test.ts` and `artifactKitTokens()` use to locate each token region — identical in `ARTIFACT_KIT_CSS` and `packages/ui/src/index.css`. */
export const ARTIFACT_KIT_MARKERS = {
  dark: "[data-theme='dark'] {",
  light: "[data-theme='light'] {",
  scale: ':root {',
} as const;

/** Surface, text, accent and the nine status tokens — present in both the dark and light blocks. */
export const ARTIFACT_KIT_THEME_TOKEN_NAMES = [
  '--bg-0', '--bg-1', '--bg-2', '--bg-3', '--bg-input', '--line-1', '--line-2', '--line-3',
  '--text-1', '--text-2', '--text-3', '--text-4', '--text-strong', '--text-soft', '--text-body', '--text-nav',
  '--accent', '--accent-link', '--accent-hover', '--accent-on', '--accent-tint', '--accent-tint-strong', '--accent-edge', '--focus-ring',
  '--status-idle', '--status-working', '--status-stalled', '--status-blocked', '--status-needs-you', '--status-merging', '--status-done', '--status-failed', '--status-paused',
  '--overlay', '--elev-sheet', '--elev-float',
] as const;

/** Space, radius, font-family, font-size, tracking and the one purely-CSS motion pair — theme-independent. */
export const ARTIFACT_KIT_SCALE_TOKEN_NAMES = [
  '--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-7', '--space-8', '--space-9',
  '--r4', '--r6', '--r8', '--r10', '--r-pill', '--r-device',
  '--ff-ui', '--ff-mono',
  '--fs-display', '--fs-title', '--fs-head', '--fs-body', '--fs-ui', '--fs-meta', '--fs-micro', '--fs-nano',
  '--track-display', '--track-title', '--track-head', '--track-micro', '--track-label',
  '--dur-fast', '--ease',
] as const;

/** Every token the kit promises — the drift test's allowlist. See the module doc for what's excluded and why. */
export const ARTIFACT_KIT_TOKEN_NAMES: readonly string[] = [...ARTIFACT_KIT_THEME_TOKEN_NAMES, ...ARTIFACT_KIT_SCALE_TOKEN_NAMES];

export const ARTIFACT_KIT_CSS = `/* ------------------------------------------------------------------ *
 * The AC Artifact Kit — Weave AI's design tokens plus a compact, dependency-free semantic
 * layer, for a single self-contained HTML artifact. No JavaScript, no build step, no external
 * reference of any kind. Dark is the default theme; add [data-theme='light'] to an ancestor
 * element to opt an artifact into the light theme.
 * ------------------------------------------------------------------ */

:root,
[data-theme='dark'] {
  color-scheme: dark;

  --bg-0: #050506;
  --bg-1: #0b0b0d;
  --bg-2: #101012;
  --bg-3: #17171a;
  --bg-input: #08080a;
  --line-1: #17171a;
  --line-2: #222226;
  --line-3: #313137;

  --text-1: #e9eaec;
  --text-2: #9ca1aa;
  --text-3: #868c95;
  --text-4: #868c95;
  --text-strong: #f2f3f5;
  --text-soft: #c6cad1;
  --text-body: #d8dbe0;
  --text-nav: #7c828b;

  --accent: #3d4148;
  --accent-link: #c6cad1;
  --accent-hover: #c6cad1;
  --accent-on: #fff;
  --accent-tint: rgb(61 65 72 / 0.13);
  --accent-tint-strong: rgb(61 65 72 / 0.18);
  --accent-edge: rgb(61 65 72 / 0.34);
  --focus-ring: rgb(61 65 72 / 0.18);

  --status-idle: #8a8f98;
  --status-working: #e9a23b;
  --status-stalled: #c98a2e;
  --status-blocked: #ff6b4a;
  --status-needs-you: #7c87f0;
  --status-merging: #8a8f98;
  --status-done: #7c828b;
  --status-failed: #e5484d;
  --status-paused: #8a8f98;

  --overlay: rgb(0 0 0 / 0.62);
  --elev-sheet: 0 16px 48px rgb(0 0 0 / 0.6);
  --elev-float: 0 4px 16px rgb(61 65 72 / 0.4);
}

[data-theme='light'] {
  color-scheme: light;

  --bg-0: #f7f8f9;
  --bg-1: #fff;
  --bg-2: #f2f3f5;
  --bg-3: #eaecef;
  --bg-input: #fff;
  --line-1: #e6e8eb;
  --line-2: #d3d6db;
  --line-3: #c7cad0;

  --text-1: #16181c;
  --text-2: #565a61;
  --text-3: #676c74;
  --text-4: #676c74;
  --text-strong: #0c0d10;
  --text-soft: #3d4148;
  --text-body: #24272c;
  --text-nav: #676c74;

  --accent: #3d4148;
  --accent-link: #3d4148;
  --accent-hover: #3d4148;
  --accent-on: #fff;
  --accent-tint: rgb(61 65 72 / 0.09);
  --accent-tint-strong: rgb(61 65 72 / 0.18);
  --accent-edge: rgb(61 65 72 / 0.34);
  --focus-ring: rgb(61 65 72 / 0.18);

  --status-idle: #6b7078;
  --status-working: #8a5e14;
  --status-stalled: #96631a;
  --status-blocked: #c93a17;
  --status-needs-you: #4a55c4;
  --status-merging: #4e535b;
  --status-done: #565a61;
  --status-failed: #c22b31;
  --status-paused: #6b7078;

  --overlay: rgb(16 24 32 / 0.28);
  --elev-sheet: 0 16px 48px rgb(16 24 32 / 0.18);
  --elev-float: 0 4px 16px rgb(61 65 72 / 0.3);
}

:root {
  --space-1: 0.125rem;
  --space-2: 0.25rem;
  --space-3: 0.375rem;
  --space-4: 0.5rem;
  --space-5: 0.75rem;
  --space-6: 1rem;
  --space-7: 1.5rem;
  --space-8: 2rem;
  --space-9: 3rem;

  --r4: 0.25rem;
  --r6: 0.375rem;
  --r8: 0.5rem;
  --r10: 0.625rem;
  --r-pill: 999px;
  --r-device: 1.625rem;

  --ff-ui: 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --ff-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;

  /* The type scale is one family scaled by this multiplier, matching index.css (VS-551). An artifact
     document defines it at 1; it is the same expression the app's own root block carries. */
  --fs-scale: 1;
  --fs-display: calc(1.75rem * var(--fs-scale));
  --fs-title: calc(1.25rem * var(--fs-scale));
  --fs-head: calc(1rem * var(--fs-scale));
  --fs-body: calc(0.875rem * var(--fs-scale));
  --fs-ui: calc(0.8125rem * var(--fs-scale));
  --fs-meta: calc(0.75rem * var(--fs-scale));
  --fs-micro: calc(0.6875rem * var(--fs-scale));
  --fs-nano: calc(0.625rem * var(--fs-scale));

  --track-display: -0.02em;
  --track-title: -0.015em;
  --track-head: -0.01em;
  --track-micro: 0.02em;
  --track-label: 0.1em;

  --dur-fast: 80ms;
  --ease: cubic-bezier(0.2, 0.8, 0.3, 1);
}

/* ------------------------------------------------------------------ * base * ---------------- */

*, *::before, *::after {
  box-sizing: border-box;
}
html, body {
  margin: 0;
}
body {
  background: var(--bg-0);
  color: var(--text-1);
  font-family: var(--ff-ui);
  font-size: var(--fs-body);
  line-height: 1.5;
}
::selection {
  background: var(--accent-tint-strong);
}
a {
  color: var(--accent-link);
}
:focus-visible {
  outline: none;
  border-radius: var(--r4);
  box-shadow: 0 0 0 3px var(--focus-ring);
}

/* ------------------------------------------------------------- * layout safety * ------------- */

.grid, .row, .cols {
  display: flex;
  min-width: 0;
}
.grid > *, .row > *, .cols > * {
  min-width: 0;
}
.prose, .table, .badge, .label {
  overflow-wrap: anywhere;
}
img, svg, video {
  max-width: 100%;
  height: auto;
}

/* -------------------------------------------------------------- * semantic layer * ------------ */

.page {
  max-width: 960px;
  margin: 0 auto;
  padding: var(--space-8);
}
.section {
  margin-block: var(--space-8);
}
.section > h2 {
  font-size: var(--fs-title);
  letter-spacing: var(--track-title);
  color: var(--text-strong);
  margin: 0 0 var(--space-5);
}
.card {
  background: var(--bg-1);
  border: 1px solid var(--line-1);
  border-radius: var(--r6);
  padding: var(--space-6);
}
.panel {
  background: var(--bg-1);
  border: 1px solid var(--line-2);
  border-radius: var(--r8);
  padding: var(--space-7);
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-6);
  border-radius: var(--r6);
  border: 1px solid var(--line-2);
  background: var(--bg-2);
  color: var(--text-1);
  font-family: var(--ff-ui);
  font-size: var(--fs-ui);
  text-decoration: none;
  transition: background var(--dur-fast) var(--ease);
}
.btn:hover {
  background: var(--bg-3);
}
.btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-on);
}
.btn-primary:hover {
  background: var(--accent-hover);
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--r-pill);
  border: 1px solid var(--line-1);
  background: var(--bg-2);
  color: var(--text-2);
  font-family: var(--ff-mono);
  font-size: var(--fs-nano);
  letter-spacing: var(--track-label);
  text-transform: uppercase;
}
.status-idle { color: var(--status-idle); }
.status-working { color: var(--status-working); }
.status-stalled { color: var(--status-stalled); }
.status-blocked { color: var(--status-blocked); }
.status-needs-you { color: var(--status-needs-you); }
.status-merging { color: var(--status-merging); }
.status-done { color: var(--status-done); }
.status-failed { color: var(--status-failed); }
.status-paused { color: var(--status-paused); }
.status-dot::before {
  content: '';
  display: inline-block;
  width: 0.5em;
  height: 0.5em;
  margin-right: var(--space-3);
  border-radius: 50%;
  background: currentColor;
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-body);
}
.table th, .table td {
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--line-1);
  text-align: left;
}
.table th {
  color: var(--text-2);
  font-size: var(--fs-meta);
  font-weight: 500;
  letter-spacing: var(--track-label);
  text-transform: uppercase;
}
code, kbd {
  font-family: var(--ff-mono);
  font-size: 0.9em;
}
code {
  background: var(--bg-2);
  padding: 0.1em 0.35em;
  border-radius: var(--r4);
}
kbd {
  background: var(--bg-3);
  border: 1px solid var(--line-2);
  border-radius: var(--r4);
  padding: 0.05em 0.4em;
  box-shadow: 0 1px 0 var(--line-3);
}
pre code {
  display: block;
  padding: var(--space-6);
  border-radius: var(--r6);
  background: var(--bg-2);
  overflow-x: auto;
}
.steps {
  list-style: decimal;
  margin: 0;
  padding-left: var(--space-7);
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}
.steps > li {
  padding-left: var(--space-3);
}
.timeline {
  list-style: none;
  margin: 0;
  padding-left: var(--space-7);
  border-left: 2px solid var(--line-2);
  display: flex;
  flex-direction: column;
  gap: var(--space-7);
}
.timeline > li {
  position: relative;
}
.timeline > li::before {
  content: '';
  position: absolute;
  left: calc(-1 * var(--space-7) - 5px);
  top: 0.4em;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
}

/* -------------------------------------------------------------- * image gallery * ------------ */
/* A labelled grid of images whose cells open into a full-viewport, pannable, zoomable viewer.
   Pure CSS state: :target opens a cell, the hidden checkbox + label zooms it, overflow: auto
   pans. No JavaScript — the served artifact's CSP has no script-src, so a script would never run.
   Each image is embedded once; the same <img> is the thumbnail and the enlarged view. */

.gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: var(--space-5);
  margin: 0;
}
.gallery-figure {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: 0;
  padding: var(--space-4);
  border: 1px solid var(--line-1);
  border-radius: var(--r6);
  background: var(--bg-1);
}
.gallery .shot {
  display: block;
  overflow: hidden;
  border: 1px solid var(--line-2);
  border-radius: var(--r4);
  background: var(--bg-2);
  line-height: 0;
}
.gallery .shot img {
  display: block;
  width: 100%;
  height: auto;
}
.gallery-caption {
  font-size: var(--fs-meta);
  color: var(--text-2);
}

/* Visually hidden but still focusable, so the zoom control is keyboard-reachable. */
.gallery-zoom {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  clip-path: inset(50%);
  overflow: hidden;
  white-space: nowrap;
}
.gallery-close,
.gallery-zoom-btn,
.gallery-nav {
  display: none;
}

/* --- the cell, once targeted, becomes the viewer --- */
.gallery-figure:target {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-5);
  margin: 0;
  padding: var(--space-8);
  border: 0;
  border-radius: 0;
  background: var(--overlay);
  overflow: auto;
  overscroll-behavior: contain;
}
.gallery-figure:target .shot {
  margin: auto;
  border: 0;
  background: none;
  overflow: visible;
}
.gallery-figure:target .shot img {
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: 80vh;
  border-radius: var(--r6);
  box-shadow: var(--elev-sheet);
}
.gallery-figure:target .gallery-caption {
  color: var(--text-soft);
  text-align: center;
}
/* Zoom to natural size; the auto margins stop centring and the viewer scrolls to pan. */
.gallery-zoom:checked ~ .shot img {
  max-width: none;
  max-height: none;
}
.gallery-figure:target .gallery-close,
.gallery-figure:target .gallery-zoom-btn,
.gallery-figure:target .gallery-nav {
  display: inline-flex;
}
.gallery-close {
  position: fixed;
  top: var(--space-6);
  right: var(--space-6);
  z-index: 21;
}
.gallery-zoom-btn {
  position: fixed;
  top: var(--space-6);
  right: calc(var(--space-6) + 5rem);
  z-index: 21;
  cursor: pointer;
}
.gallery-zoom-btn::after {
  content: 'Zoom';
}
.gallery-zoom:checked ~ .gallery-zoom-btn::after {
  content: 'Fit';
}
.gallery-nav {
  position: fixed;
  left: 50%;
  bottom: var(--space-6);
  gap: var(--space-4);
  z-index: 21;
  transform: translateX(-50%);
}
.gallery-nav a {
  min-width: 2.5rem;
  justify-content: center;
}
`;

export interface ArtifactKitTokens {
  dark: Record<string, string>;
  light: Record<string, string>;
  scale: Record<string, string>;
}

/** The kit's token block, parsed — the same parser and markers the drift test uses. */
export function artifactKitTokens(): ArtifactKitTokens {
  return {
    dark: parseCssCustomProperties(extractCssBlock(ARTIFACT_KIT_CSS, ARTIFACT_KIT_MARKERS.dark)),
    light: parseCssCustomProperties(extractCssBlock(ARTIFACT_KIT_CSS, ARTIFACT_KIT_MARKERS.light)),
    scale: parseCssCustomProperties(extractCssBlock(ARTIFACT_KIT_CSS, ARTIFACT_KIT_MARKERS.scale)),
  };
}

export interface ArtifactKitComponent {
  className: string;
  description: string;
}

/** The kit's semantic class layer — documentation of CSS this same change adds, not parsed from anywhere. */
export const ARTIFACT_KIT_COMPONENTS: readonly ArtifactKitComponent[] = [
  { className: 'page', description: 'Top-level content column: max width, centered, outer padding.' },
  { className: 'section', description: 'Vertical rhythm between major blocks; a direct `h2` child gets the title treatment.' },
  { className: 'card', description: 'Lowest-emphasis container — subtle border, tight radius.' },
  { className: 'panel', description: 'Higher-emphasis container than `.card` — stronger border, larger radius and padding.' },
  { className: 'btn', description: 'A button-styled element for showing an action, not a real control (artifacts have no JS). Add `.btn-primary` for the accent-filled variant.' },
  { className: 'badge', description: 'Small pill label — monospace, uppercase, tracked.' },
  { className: 'status-idle | status-working | status-stalled | status-blocked | status-needs-you | status-merging | status-done | status-failed | status-paused', description: 'Text-color utilities keyed to the nine AC status tokens. Combine with `.status-dot` for a leading colored dot.' },
  { className: 'table', description: 'Data table: full width, bottom-ruled rows, uppercase tracked header cells.' },
  { className: 'code / kbd', description: 'Inline code and keyboard-key styling; wrap `code` in `pre` for a code block.' },
  { className: 'steps', description: 'A numbered vertical list for a plan or procedure.' },
  { className: 'timeline', description: 'A dotted vertical line with entries beside it, for a sequence of events.' },
  { className: 'gallery', description: 'A responsive grid of labelled image cells; pair with `.gallery-figure`/`.shot`/`.gallery-caption`.' },
  { className: 'gallery-figure', description: 'One gallery cell: a captioned thumbnail that `:target` promotes to a full-viewport viewer. Give it a unique `id` and link to it with `.shot`.' },
  { className: 'shot', description: 'The thumbnail link (`<a class="shot" href="#cell-id">` around the `<img>`) that opens its cell full-viewport.' },
  { className: 'gallery-caption', description: 'A short caption under a gallery image.' },
  { className: 'gallery-zoom / gallery-zoom-btn', description: 'The hidden checkbox plus its `<label>` that toggles the open image between fit and natural size, with no JavaScript.' },
  { className: 'gallery-close / gallery-nav', description: 'The fixed Close link (to the grid\'s own id) and the optional prev/next `<nav>` inside an open gallery cell.' },
] as const;

/**
 * The `weave-ai-artifacts` skill's playbook markdown, read at call time so the tool result
 * and the skill an agent reads directly are the same bytes — never a hand-duplicated second copy.
 * Mirrors `workers/home.ts`'s `skillsFor()`: a missing skill directory yields an empty object, not
 * a thrown error.
 */
export function readArtifactPlaybooks(skillsDir: string): Record<string, string> {
  const dir = join(skillsDir, 'weave-ai-artifacts', 'references');
  if (!skillsDir || !existsSync(dir)) return {};
  let entries: string[] = [];
  try { entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name); } catch { return {}; }
  const out: Record<string, string> = {};
  for (const name of entries) {
    const stem = name.slice(0, -3);
    try { out[stem] = readFileSync(join(dir, name), 'utf8'); } catch { /* skip an unreadable file rather than fail the whole tool call */ }
  }
  return out;
}
