# Gallery playbook

For a set of related images a reader needs to scan and then inspect — the before-captures from one
delivery, the same screen at several widths, a sequence of states. Reach for this instead of attaching
the images as separate files or a zip: a flat attachment list is hard to read and a zip hides every
image behind a download. Build one when **four or more** images belong together; a single screenshot,
or a two-capture before/after pair, stays on the pattern you already use.

## Technique

- One `.gallery` is a responsive grid of `.gallery-figure` cells. Each cell holds a unique `id`, an
  `<input class="gallery-zoom">` (the zoom state), an `<a class="shot" href="#that-id">` wrapping the
  image, a `.gallery-caption`, a `Close` link back to the grid's own `id`, a
  `<label class="btn gallery-zoom-btn">`, and — optional but useful — a `.gallery-nav` with prev/next
  links to the neighbouring cells.
- Group a large set into `.section`s with an `h2` (per tab, per width, per step). A delivery's
  captures are not one flat wall, and the heading is what lets a reader skip to what they came for.
- Every image is a `data:` URI and is embedded **once**: the same `<img>` is the thumbnail and the
  opened view, so never add a second copy for the viewer.
- It is CSS-only. Following a `.shot` link `:target`s its cell, which becomes a fixed full-viewport
  viewer; scrolling pans it; the zoom label switches the image between fitting the viewport and its
  natural size. There is no JavaScript, no external file and no CDN — a served artifact cannot run a
  script at all, so this is the only kind of interactivity an artifact can have.
- Give every image a one-line caption — the view, the width, the state. A grid of unlabelled
  screenshots is barely better than the zip it replaces.
- **Size budget.** The artifact body is capped at 2,000,000 characters and base64 adds roughly a
  third, so embed downscaled images (a review capture around 1280–1600px wide as JPEG is plenty) and,
  if the set still does not fit, split it across more than one gallery artifact. Keep the
  full-resolution originals as ticket attachments; the gallery is the presentation layer.

## Worked skeleton

```html
<section class="section">
  <h2>Before — Home</h2>
  <div class="gallery" id="gallery-before">
    <figure class="gallery-figure" id="shot-home-390">
      <input class="gallery-zoom" type="checkbox" id="zoom-home-390" aria-label="Toggle zoom">
      <a class="shot" href="#shot-home-390" aria-label="Open Home at 390px">
        <img src="data:image/png;base64,iVBORw0KGgo…" alt="Home at 390px">
      </a>
      <figcaption class="gallery-caption">Home · 390px</figcaption>
      <a class="btn gallery-close" href="#gallery-before">Close</a>
      <label class="btn gallery-zoom-btn" for="zoom-home-390"></label>
      <nav class="gallery-nav" aria-label="Other captures">
        <a class="btn" href="#shot-home-768">‹</a>
        <a class="btn" href="#shot-home-768">›</a>
      </nav>
    </figure>
    <!-- one .gallery-figure per image; every id unique across the document -->
  </div>
</section>
```

Reuse this markup exactly — the kit's CSS keys on these class names. When the opened image is larger
than the viewport, `Zoom` reveals it at full resolution and the viewer scrolls to pan; when it already
fits, `Zoom` has nothing to change.
