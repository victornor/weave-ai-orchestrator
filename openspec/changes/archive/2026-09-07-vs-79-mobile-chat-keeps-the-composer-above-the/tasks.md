# Tasks

- [x] 1. Ask the browser to shrink the layout viewport for the keyboard where it can, with `interactive-widget=resizes-content`.
- [x] 2. Measure the region the browser is actually showing and publish it as custom properties, mirroring the browser's own pan rather than fighting it, and ignoring a pinch-zoom and a difference too small to be a keyboard.
- [x] 3. Install the watcher before the first render, so nothing is ever laid out against a stale height.
- [x] 4. Size the shell, the tab bar, every overlay and every capped panel against those properties, whose defaults are the `dvh` they replace, and collapse the safe-area gap while the keyboard is open.
- [x] 5. Make the follow watch geometry as well as content: re-pin a following list instantly when the list, its content or the visual viewport changes size, and leave a scrolled-up list alone.
- [x] 6. Tests: the measurement and its publishing, a `visualViewport` and a `ResizeObserver` jsdom can be given, and a chat suite covering the list shrinking under the keyboard, a visual-viewport resize, the stream still being followed, and the button not appearing merely because the list got shorter.
- [x] 7. Add the `workspace-navigation/phone-keyboard-viewport` capability for what the app does when the shown region is not the page.
