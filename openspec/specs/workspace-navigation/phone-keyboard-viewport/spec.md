# workspace-navigation/phone-keyboard-viewport Specification

## Purpose
TBD - created by archiving change vs-79-mobile-chat-keeps-the-composer-above-the. Update Purpose after archive.

## Requirements

### Requirement: The app fills the region the browser is showing, not the page

The web app SHALL lay itself out against the region the browser is actually showing, and SHALL NOT
depend on the height the page had before an on-screen keyboard opened.

Where the browser can be asked to shrink the layout viewport for the keyboard it SHALL be asked to,
so the dynamic viewport already excludes it. Where it cannot, the app SHALL read the visual viewport
and publish that region for the layout to size against, following wherever the browser has panned to
rather than holding a position of its own.

No part of the app SHALL be sized in raw viewport units. The app shell, the phone tab bar, sheets,
the command palette, toasts and every internally capped panel SHALL be measured against the shown
region, whose value with no keyboard open is the dynamic viewport it replaces. The safe-area gap the
tab bar holds for the home indicator SHALL collapse while the keyboard is open, the indicator being
behind it.

#### Scenario: The keyboard opens

- **WHEN** the human focuses the composer on a phone and the keyboard opens
- **THEN** the composer and the tab bar are drawn directly above the keyboard, and the message list
  gives up the height rather than the composer moving

#### Scenario: Content arrives while the keyboard is open

- **WHEN** a message, a streamed event or a decision card changes the page while the keyboard is open
- **THEN** the composer and the tab bar stay exactly where they were, above the keyboard

#### Scenario: The browser pans the page

- **WHEN** the browser scrolls the visual viewport to reveal the focused input instead of shrinking
  the page
- **THEN** the app is drawn over the region it panned to, so nothing is left behind the keyboard

#### Scenario: The keyboard closes

- **WHEN** the keyboard closes
- **THEN** the app fills the whole viewport again, with the safe-area gap restored

#### Scenario: A desktop browser

- **WHEN** the app is opened on a viewport with no on-screen keyboard
- **THEN** the layout is the dynamic viewport, unchanged, and no measured pixel height overrides it

#### Scenario: The human pinch-zooms

- **WHEN** the human pinch-zooms, which shrinks the visual viewport as a keyboard does
- **THEN** the app is left the size it was, rather than shrunk to the magnified region

### Requirement: A following list stays at its newest content when the region changes

A message list that is following its newest content SHALL still be showing it after the region it is
drawn in changes size, whether that came from the keyboard, from the list's own content being
re-measured, or from something else on the screen taking height away from it.

The correction SHALL be immediate rather than animated: it restores a position the human already
had, and there is nothing new for them to watch arrive. It SHALL apply only once the list has been
positioned against real content for the first time.

A list the human has scrolled up from SHALL NOT be moved by any of this, and the scroll-to-bottom
button SHALL NOT appear merely because the list got shorter.

#### Scenario: The keyboard takes half the list away

- **WHEN** the keyboard opens under a chat that is showing its newest message
- **THEN** the shortened list is still showing that message, and no scroll-to-bottom button appears

#### Scenario: A turn streams while the keyboard is open

- **WHEN** the conductor's reply streams in while the keyboard is open
- **THEN** the list keeps following it

#### Scenario: The human had scrolled up

- **WHEN** the keyboard opens under a chat the human has scrolled up from
- **THEN** the viewport stays exactly where they left it, and the scroll-to-bottom button is still
  offered
