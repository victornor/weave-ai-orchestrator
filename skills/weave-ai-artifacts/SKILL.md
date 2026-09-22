---
name: weave-ai-artifacts
description: How and when to publish a rich, self-contained HTML artifact — diagrams, tables, comparisons, plans, code walkthroughs, change explainers — styled with the AC Artifact Kit. Load before producing an artifact, or when a ticket or comment asks for one.
---

# Publishing artifacts

An artifact is a single self-contained HTML document a human reads in the web app or standalone —
not a ticket comment, not a code change. It exists because some answers are genuinely visual or
structural: how a request flows through the system, what changed and why, a side-by-side of two
approaches. Most answers are not that. Reach for a comment first.

## When an artifact is worth it

Make one when the content has real shape a human benefits from seeing laid out — a sequence of
steps, a structure with more than two or three parts, a comparison across several dimensions, a
concrete before/after. Don't make one for a short factual answer, a status update, a single number,
or anything a paragraph says just as well — that goes in a ticket comment, which is cheaper for you
to write and cheaper for the human to read inline. When genuinely unsure, prefer the comment: an
artifact nobody needed is friction, not help.

**Many images.** When four or more images belong together — a delivery's before/after captures, one
screen at several widths, a sequence of states — build **one gallery artifact** (`references/gallery.md`)
rather than attaching the images separately or zipping them. Group a large set into labelled sections
and caption every image. One or two captures do not change: a single screenshot, or a before/after
pair, stays a ticket attachment or an inline `.card` pair.

## Format rules

An artifact is exactly one HTML file, and it has to stand on its own:

- **Inline everything.** CSS in `<style>`, SVG inline in the markup, images as `data:` URIs. No
  `<link>`, no `<script src>`, no external `<img src>`, no web fonts, no CDN of any kind.
  `file://` and a sandboxed iframe both refuse external loads anyway — build for that from the
  start rather than discovering it after.
- **No JavaScript.** An artifact is a document, not an app. Interactivity you're tempted to add
  (a toggle, a collapsible section) is usually a sign the content wants splitting into sections
  instead. The one sanctioned exception is the gallery's CSS-only viewer state — a `:target` cell and
  a checkbox zoom, see `references/gallery.md` — because a served artifact's CSP has no `script-src`
  and a script would never run anyway.
- **Use the AC Artifact Kit** for every visual choice — colors, spacing, radii, type. Call
  `weave_artifact_kit()` to get its CSS, token values, semantic component classes
  (`.page`/`.card`/`.panel`/`.btn`/`.badge`/`.table`/`.steps`/`.timeline`/`.gallery`/the nine
  `.status-*` utilities — see the tool result's `components` field for the full list with
  descriptions) and
  the playbook text below, in one call, at the point you're about to write the artifact — not
  carried in every turn's prompt. Inline the returned `css` into the document's `<style>`.
- Support both themes: default (dark) at the document root, `[data-theme='light']` on an ancestor
  opts into light. Don't hard-code a background/text pair that only works in one.
- Cite real source locations as `path:line`, never a vague "in the config" — an artifact is meant
  to be checked against the repo, not taken on faith.

## Publishing and reaching the human

An artifact you've drafted has to actually be published — it never reaches anyone as a message
attachment.

- **A worker, with a ticket:** call `weave_ticket_artifact_put(id, key, html, { title?, kind? })`.
  When the ticket's project requires a visual plan artifact (`weave_ticket_get(id).planArtifactRequired`),
  publish it under the reserved key **`plan`** — the plan approval card and Plan view show that one,
  and the daemon refuses the `proposed` transition until it exists. It supports the written plan; it
  never replaces the proposal, design, tasks or the fast path's `approach` document.
  It returns a URL; share that URL (in a comment, or in your final report), never the raw HTML file.
  Calling it again with the same `key` republishes a new revision — you republish, you never
  read-modify-write, because there is no matching read tool: an artifact's body can never be read
  back by any agent, including you.
- **A weaver, with no ticket:** call `weave_artifact_put(key, html, { title?, kind? })` instead — the
  ticketless sibling, scoped to the workspace rather than any ticket. It returns a URL that opens the
  artifact rendered inside the web app; put that URL straight into your chat reply. Same rule: no
  read-back, republish under the same `key` to revise.
- **A planning agent, drafting a plan:** call `weave_plan_artifact_put(key, html, { title?, kind? })` —
  the artifact belongs to the plan you are drafting, not to any repository or ticket, and publishing
  one is **not** a repository write. It appears as a card in the plan's conversation at the point you
  publish it, which is where a ticket-graph diagram, an options comparison, a dependency view or a
  mock of the intended change does more than prose. Publishing does **not** replace your answer: you
  must still reply through `weave_plan_reply`; the artifact supports the reply. Same rule: no
  read-back, republish under the same `key` to revise. The returned URL keeps working after the plan
  is submitted — put it in a draft's description when the ticket created from that draft should point
  at the artifact.

Either way, the returned URL is the thing that reaches the human — an attached HTML file is not a
substitute and should never be sent alongside or instead of it.

## Diagram discipline

Diagrams are where kits get abused into generic-looking output, so the rule is strict: **default to
hand-authored inline `<svg>`**, using `currentColor` (so it inherits a `.status-*` color when
wrapped in one) and the kit's tokens for stroke widths and gaps. Do not build a diagram out of
flex/grid boxes and CSS borders pretending to be arrows — it never reads as a diagram, it reads as
misaligned divs. Keep every label short (a few words, not a sentence); if a node needs a sentence,
that sentence is a caption below the diagram, not text crammed inside a shape. See
`references/diagram.md` for concrete shapes (flow, sequence, tree) and worked SVG fragments.

## Playbooks

Seven original playbooks, read on demand via `weave_artifact_kit()`'s `playbooks` field or directly from
`references/`:

| Playbook | For |
|---|---|
| `references/diagram.md` | Architecture, flow, sequence and tree diagrams — inline SVG technique. |
| `references/table.md` | Structured data with more than a couple of columns. |
| `references/comparison.md` | Two or more options, approaches, or states, side by side. |
| `references/plan.md` | A sequence of steps or phases — `.steps`/`.timeline`. |
| `references/code.md` | A code walkthrough or excerpt worth annotating, not a raw paste. |
| `references/change.md` | Before/after, files changed, and impact — the change-ticket shape. |
| `references/gallery.md` | Many related images — a labelled grid that opens, pans and zooms. |

Each playbook is short: what the shape is for, the kit classes it leans on, and one worked skeleton.
None of them are copied from another project's docs — they're written for AC's own kit and tone.

## References

- `references/diagram.md`, `references/table.md`, `references/comparison.md`, `references/plan.md`,
  `references/code.md`, `references/change.md`, `references/gallery.md` — the seven playbooks.
