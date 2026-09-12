# Design — Restore the thread running through the icon

## Context

See `proposal.md` — Why. The shipped artwork is an automatic trace (ImageMagick threshold + dilate,
then potrace) of the chosen raster mark. The only thing wrong with it is the **crop**: VS-278 used
`1280x500+380+770`, a window around the woven section that cut the entry/exit tails down to stubs.
The trace pipeline itself is fine and stays. This document covers the retrace geometry and the two
file variants, not the mark (which is fixed and out of scope).

Constraints that shape the approach:

- The source raster is 2048×2048, white strokes on transparent, with coloured edge fringing; the
  full mark's alpha bounding box is `1861x414+93+808` (x 93–1953, y 808–1221). It is a very wide
  shape — ~4.5:1 — so any square icon will carry generous vertical margin around the thread.
- The two icons are static assets served by the daemon; there is no build step that regenerates
  them, so the provenance comment in each file is the only record of how they were made.
- `icon.svg` is the rounded (mask) icon; `icon-maskable.svg` is the Android maskable icon, which the
  platform may crop to a circle. The two therefore need different framing.

## Goals / Non-Goals

**Goals**

- One crop that keeps both tails and lets each reach the left and right edges of the artwork.
- A knot that is visibly larger in the frame than the current `main` artwork.
- `icon.svg` rounded with `rx="288"`; `icon-maskable.svg` square, with the whole mark inside the
  circular safe area.
- A provenance comment in both files naming the exact command that produced them.

**Non-Goals**

- Redrawing or reinterpreting the mark, changing its stroke weight as a design choice, or adding a
  wordmark/lockup.
- A separate simplified favicon. 16px reading as a woven band rather than distinct loops is the
  accepted result; if a small-size tweak is taken it must keep the thread.
- Touch any consumer file, token, or surface other than the two SVGs.

## Decisions

### 1. Crop: a 1200×1200 window centred on the full mark

Use `-crop 1200x1200+424+415` — a square window whose centre is the mark's own centre
(`x 424–1624`, `y 415–1615`), validated while scoping. The mark spans `x 93–1953`, so both tails are
cut by the window: each strand runs off the left/right edge of the crop and the result reads as a
thread continuing past the frame. This replaces VS-278's `1280x500+380+770`, which sat inside the
tails. The narrower knot-only window is what makes the mark small; the wider window both keeps the
thread and enlarges the knot.

*Alternatives considered:* keeping VS-278's crop and padding with transparent margin — rejected,
the tails would still not exist, only the empty space around a knot would grow. Cropping to the
mark's full bounding box (`1861` wide, no tails cut) — rejected, the thread would end just inside
the frame instead of running off it, and the extra width would shrink the knot.

### 2. Dilate: `Disk:6`, tunable for `icon.svg` only

VS-278 used `Disk:12`. That was compensating for the small, tail-less crop. At the new crop the
strand is displayed larger and a lighter dilation keeps the crossing gaps open and the line crisp;
`Disk:6` is the scoping value. At 16px a single lighter stroke risks dropping out, so the apply phase
may use a heavier dilate **for `icon.svg` only** (a favicon-oriented file) if it improves 16px
without closing gaps or removing the thread, showing both. `icon-maskable.svg` is displayed on
launchers at larger sizes and keeps the lighter weight.

*Alternatives considered:* `Disk:12` for both — rejected, it thickens and can weld adjacent strands
at this scale, losing the woven texture. No dilation — rejected, the raw threshold leaves a thin,
ragged line that fringes at small sizes.

### 3. Two framings from one trace

- `icon.svg` — square viewBox sized to the 1200 crop, full-bleed `#5E6AD2` `<rect>` with
  `rx="288"` (the rounded-icon geometry VS-278 established), white path.
- `icon-maskable.svg` — same traced path, but in a **larger** viewBox so the whole mark (tail tips
  included) sits inside the circular safe area, with a square full-bleed rect. This is the same
  approach as VS-278 (`viewBox="-248.7 -643.7 1776.4 1776.4"` around the `icon.svg`-scale path),
  re-derived for the new wider crop; the tail tips must be the limiting horizontal extent against
  the circle, since the mark is wider than it is tall.

*Alternatives considered:* shipping the same viewBox in both — rejected, the maskable circle would
clip the tail tips. Reaching the square's corners — rejected, those are outside the safe circle and
the platform crops them.

### 4. Provenance comment carries the real command

Both files keep a machine-traced provenance comment, updated to the crop and dilate actually used,
with the profile (`threshold 50%`, dilate) explicit. The source raster path is **not** committed;
the comment names it as `<source>.png` or the attachment id as VS-278 did.

## Risks / Trade-offs

- **Trace artefacts at the new crop** (fringing/ragged edges) → the threshold + dilate pipeline is
  unchanged from the accepted VS-278 trace; verify by eye at 256px and 16px.
- **16px loses the strand** → accepted per the ticket; if a heavier dilate for `icon.svg` recovers
  legibility without removing the thread, take it and attach both renders.
- **Maskable tail tips clipped by the circle** → verify by rendering `icon-maskable.svg` composited
  under a circular mask, not by eye on the square; iterate the viewBox until nothing touches the
  crop edge.
- **Source raster accidentally committed** → it lives outside the repo under `.agent-conductor/`;
  confirm `git status` shows only the two SVGs.
- **Filenames/consumers drift** → filenames unchanged; grep the three consumers to confirm.

## Migration Plan

Not applicable — static assets served from `packages/ui/public`; the daemon reads them from disk, so
the change takes effect when the built UI is upgraded. Rollback is restoring the two files.

## Open Questions

None. The crop and dilate numbers are a working starting point (per the ticket) and the apply phase
is authorised to tune them; the acceptance criteria in the ticket bound what "good" means.
