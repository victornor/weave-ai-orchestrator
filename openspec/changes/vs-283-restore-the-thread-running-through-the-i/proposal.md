# Restore the thread running through the icon — the tails are the mark, not decoration

Tracker change for [VS-283](conductor://tickets/VS-283). A `task` ticket, so this change carries
tasks only — `skip_specs: true`.

## Why

VS-278 shipped the traced mark cropped tightly to the woven section, with the horizontal entry/exit
tails trimmed to stubs. Captain rejected that: *"It's important that we have the thread between
before and after the weave… It was like a thread with a weave in the middle. Now you've cropped it,
so there's just the weave."* The tails are the subject, not padding. The mark is a **thread that
passes through a knot**; without the thread it is just a knot, and the icon stops reading as the
product mark.

The crop was the conductor's own instruction — first in VS-278, then again in the 16px follow-up —
and it was wrong both times. This change reverses it.

## What Changes

- Retrace both shipped icons (`packages/ui/public/icon.svg`,
  `packages/ui/public/icon-maskable.svg`) from the same source raster with a crop that **keeps the
  tails and lets the thread run to the icon's edges**, so it reads as a thread continuing past the
  frame rather than a shape sitting inside a margin.
- The knot becomes visibly larger within the frame than what is on `main` today (the wider crop
  includes more of the mark, not less).
- Everything VS-278 established stays: white on `#5E6AD2`; `rx="288"` on `icon.svg` only; the
  maskable variant square with its own safe-area scale; the provenance comment naming the exact
  regeneration command; filenames unchanged; the source raster not committed.
- **16px is accepted as-is.** No cropping the tails to win favicon legibility — that trade was
  already made once and rejected. With the thread kept, 16px renders as a woven band with visible
  texture rather than distinct loops; that is the accepted small-size result. Any small-size
  improvement that keeps the thread (heavier dilate for `icon.svg` only, a slightly tighter vertical
  crop) may be taken, showing both, but must not remove the thread.

## Capabilities

None. This is shipped static artwork, not spec-level behaviour; a spec would have to invent a
requirement describing pixels. `skip_specs: true` is set in `.openspec.yaml`.

## Impact

- `packages/ui/public/icon.svg` — retraced, tails restored, `rx="288"` kept.
- `packages/ui/public/icon-maskable.svg` — retraced from the same crop, square safe-area geometry.
- The provenance comment in both files is updated to the command actually used.
- No code, route, config or dependency changes. Consumers (`packages/ui/index.html`,
  `packages/ui/public/manifest.webmanifest`, `packages/ui/public/sw.js`) already reference the
  filenames and stay untouched.

## Verification sketch

The working crop validated while scoping this change:

```sh
src=/home/user/agent-conductor/workspace/.agent-conductor/attachments/01M29SK9W7BNDBBQWBSCJR4YJA.png
magick "$src" -crop 1200x1200+424+415 +repage \
  -alpha extract -threshold 50% -morphology Dilate Disk:6 -negate /tmp/knot.pbm
potrace /tmp/knot.pbm -s -o /tmp/knot.svg
```

The mark's full bounding box in the source is `1861x414+93+808`; the 1200-wide crop is centred on
it, so it cuts through both tails — the thread reaches both crop edges and the knot is larger than
the VS-278 crop (which used `1280x500+380+770`). The exact numbers are a starting point, not gospel;
the apply phase may adjust them and must say what it changed and why.
