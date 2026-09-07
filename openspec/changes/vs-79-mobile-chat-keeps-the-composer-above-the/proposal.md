## Why

The workspace owner reports that on a phone the conductor chat "automatically push[es] the composer
and bottom bar below the keyboard… The browser pushes it up when the keyboard appears, but a live
chat seems to push it back down", and that the chat is still not reliably at its newest message.

Both come from the same wrong assumption: that the page is as tall as the screen.

**The keyboard does not shrink the layout viewport.** By default a mobile browser keeps the page at
its full height, shrinks the *visual* viewport and pans it so the focused input is on screen.
The app shell was `h-dvh` and the phone tab bar `fixed bottom-0`, both measured against the layout
viewport — so the bar, and the composer sitting on top of it, were always laid out *underneath* the
keyboard. What the owner saw as "the browser pushes it up" is that pan; what they saw as "a live
chat pushes it back down" is the pan being spent the moment anything reflows. Nothing in the app was
ever above the keyboard; only the browser's pan was, and every arriving message threw it away.

Measured in Chromium at 390×844 with the visual viewport shrunk to 508px — the same page, with the
new custom properties in place and with them removed:

| | tab bar | composer | message list |
|---|---|---|---|
| before | 766–844 | 712–745 | 617px |
| after | 430–508 | 376–409 | 281px |

The keyboard covers 508–844. Before, both the bar and the composer are inside it. After, the list
gives up the height instead and both sit directly on top of the keys.

**The follow only ever watched content.** `useStickToBottom` re-scrolls when its `signal` changes —
new messages, streamed events, the pinned decision count. The keyboard opening changes none of
those: it takes half the list's height away without changing a single message, so the effect never
runs and a list that was showing its newest message quietly stops. The same hole covers a web font
landing, an image loading and the pinned decision area growing, which is why the chat can be found
short of the bottom with no keyboard involved at all — the remaining half of what VS-63 fixed.

## What Changes

- **`interactive-widget=resizes-content`** in the viewport meta. Where it is honoured (Chrome on
  Android) the browser shrinks the layout viewport itself, `100dvh` already excludes the keyboard
  and no script is involved.
- **A `visualViewport` mirror** (`packages/ui/src/lib/viewport.ts`) for Safari, which does not
  support it. It publishes the region the browser is actually showing as `--ac-app-h`,
  `--ac-app-top` and `--ac-app-bottom`, and marks the root `data-keyboard="open"`. It *mirrors*
  rather than fights: the app is drawn over wherever the browser has panned to, so the two never
  disagree about a position and there is nothing to oscillate over. With no keyboard the properties
  are removed outright and the stylesheet's `dvh` defaults are what the layout reads.
- **Nothing is sized in raw viewport units any more.** The shell, the tab bar, the sheets, the
  command palette, the toasts, the pinned decision area, the composer's growth cap and the nested
  run transcript all size against `--ac-app-h` / `--ac-app-top` / `--ac-app-bottom`, whose defaults
  are the same `dvh` they used before. The safe-area gap the bar holds for the home indicator
  collapses while the keyboard is open, because the indicator is behind the keys.
- **The follow watches geometry as well as content.** `useStickToBottom` observes the scrolling
  element and its content with a `ResizeObserver` and listens for visual-viewport resizes; a list
  that is following is re-pinned to its bottom instantly whenever the geometry changes. A list the
  human has scrolled up from is not touched, and the pin waits for the opening jump.

## Capabilities

### New Capabilities

- `workspace-navigation/phone-keyboard-viewport`: what the app does when the region the browser is
  showing is not the page — the shell, the tab bar and every overlay stay inside it, and a list that
  was following its newest content still is afterwards.

### Modified Capabilities

(None.)

## Impact

- `packages/ui/index.html` — `interactive-widget=resizes-content`.
- `packages/ui/src/lib/viewport.ts` — new; the measurement, the properties and the watcher.
- `packages/ui/src/main.tsx` — installs the watcher before the first render.
- `packages/ui/src/index.css` — the four custom properties, `.ac-app`, `.ac-viewport`, and `.ac-bar`
  / `.ac-bar-pad` / `.ac-safe-bottom` reading `--ac-safe-bottom`.
- `packages/ui/src/app/AppShell.tsx`, `src/app/BottomBar.tsx`, `src/components/Sheet.tsx`,
  `src/components/CommandPalette.tsx`, `src/components/Toast.tsx`,
  `src/components/Composer.tsx`, `src/components/RunTranscript.tsx`, `src/routes/Chat.tsx` — sized
  against the properties instead of `dvh` / `svh` / `vh`.
- `packages/ui/src/lib/stickToBottom.ts` — the geometry listener.
- `packages/ui/src/test/` — `viewport.test.tsx`, the `visualViewport` and `ResizeObserver` fakes,
  and a keyboard suite in `chat.test.tsx`.
- Nothing outside the web app: no route, no daemon behaviour, no data.

## Out of scope

- Redesigning the composer.
- `WorkerPage`'s transcript, which still scrolls unconditionally and passes no `ready`.
