## MODIFIED Requirements

### Requirement: A ticket reference opens a modal over the chat on desktop

Activating a ticket reference in a chat SHALL go through one shared link handler used by the weaver
chat, the planning chat and a persistent session's chat, so all three inherit the same behaviour and
none builds its own navigation.

On a desktop viewport the handler SHALL open the ticket in a modal over the chat instead of
navigating away. The modal SHALL show the ticket's live feed — reusing the ticket detail and the
live-feed components the ticket page uses, not a second view — and SHALL carry a small control at
the top that opens the full ticket page. The modal SHALL be dismissible by Escape, its close control
and its backdrop; closing it SHALL leave the chat's scroll position and any composer draft intact,
because the chat is never unmounted. Where the ticket identifier does not exist in the workspace,
the modal SHALL show the existing not-found state rather than a broken modal. On a phone viewport
the handler SHALL navigate to the ticket page, as before. The one surface that SHALL keep direct
navigation is the ticket page's own feed, where a modal over the ticket already shown would be
redundant.

The modal SHALL be a bounded column between its own maximum height and a floor that keeps a short
feed from collapsing: its identity header — the identifier row, the title, the worker line and the
live activity line — SHALL stay pinned at the top while the activity feed scrolls in the one region
below it, and the document and the page behind the modal SHALL NOT scroll (no scroll chaining, and
the backdrop does not scroll). The panel SHALL hold a stable size from its loading state to its
loaded state, and focus SHALL land inside the modal on open and return to the control that opened it
on close.

#### Scenario: A click opens the modal instead of navigating

- **WHEN** the human clicks a ticket tag in the weaver, planning or session chat on a desktop viewport
- **THEN** a modal opens over the chat showing that ticket, and the chat is not navigated away from

#### Scenario: The modal shows the live feed

- **WHEN** the modal is open on a ticket with a running worker
- **THEN** it shows the ticket's live activity and its turn feed through the ticket page's own feed components

#### Scenario: The modal follows the app's theme

- **WHEN** the app is in light theme and the modal is open
- **THEN** the modal panel, its text and its backdrop render in the light token set, because a portalled dialog mirrors the active theme rather than falling back to the document default

#### Scenario: The top control opens the full ticket page

- **WHEN** the human activates the modal's control at the top
- **THEN** the full ticket page opens

#### Scenario: Escape, the close control and the backdrop close it

- **WHEN** the modal is open and the human presses Escape, clicks its close control, or clicks the backdrop
- **THEN** the modal closes and the chat behind it is unchanged, with its scroll position and draft intact

#### Scenario: An unknown identifier shows not-found in the modal

- **WHEN** the human clicks a tag whose ticket does not exist in the workspace
- **THEN** the modal shows the existing "No ticket X in this workspace." state with a way out, not a broken modal

#### Scenario: Phone keeps navigating to the ticket page

- **WHEN** the human clicks a ticket tag on a phone viewport
- **THEN** the ticket page opens, as before

#### Scenario: The chats share one handler

- **WHEN** the weaver, planning and session chats each render ticket references
- **THEN** each activates them through the same shared link handler, so the modal-vs-navigation choice cannot diverge between them

#### Scenario: The header stays while the feed scrolls

- **WHEN** the human scrolls a long activity feed inside the modal
- **THEN** the identifier row, title, worker line and live activity line stay visible at the top, and only the feed moves

#### Scenario: Scrolling the feed does not move the page behind

- **WHEN** the human scrolls the feed to its end and keeps scrolling, or scrolls the backdrop
- **THEN** the page behind the modal does not scroll, because the feed contains its own overscroll and the open modal holds the page

#### Scenario: A short feed does not leave a tall empty box

- **WHEN** the ticket's activity feed holds one comment and no runs
- **THEN** the modal is its content height up to a modest floor, not a full-height empty panel

#### Scenario: Stable size from loading to loaded

- **WHEN** the modal opens and the ticket detail and feed are still loading
- **THEN** the feed area is already at its resting size with the skeleton filling it, and the panel does not jump taller when the content arrives

#### Scenario: A long title wraps without unpinning the header

- **WHEN** the ticket's title is long enough to wrap across several lines
- **THEN** it wraps inside the pinned header, the header stays at the top, and the feed keeps its scrolling region

#### Scenario: Focus enters and leaves sensibly

- **WHEN** the modal opens, and later closes by any route
- **THEN** focus lands inside the dialog on open and returns to the control that opened it on close, rather than falling back to the document body

## ADDED Requirements

### Requirement: The modal's activity feed follows new output until the reader scrolls up

The ticket modal's activity feed SHALL follow its newest content while the reader is at the bottom —
a live turn streaming, or a new comment arriving, SHALL stay in view without the human scrolling —
and SHALL pause the follow when the reader scrolls the feed up, marking new content instead of
moving their position. A jump-to-latest control SHALL be offered while the follow is paused;
activating it, or the reader scrolling back to the bottom, SHALL resume. This behaviour SHALL reuse
the one follow implementation the chat and the persistent session page use, not a third copy, and
SHALL measure the feed element rather than the document.

#### Scenario: A live turn stays in view

- **WHEN** a worker's turn streams new output into the modal while the human is at the bottom of the feed
- **THEN** the feed follows the newest output and the newest line stays visible

#### Scenario: Scrolling up pauses the follow

- **WHEN** the human scrolls the feed up to read earlier activity while a turn is live
- **THEN** the feed stops following, their reading position stays put as new output arrives, and a jump-to-latest control appears

#### Scenario: Returning to the bottom resumes following

- **WHEN** the human activates the jump-to-latest control, or scrolls back to the bottom themselves
- **THEN** the feed returns to its newest item and follows new content again

#### Scenario: One follow implementation

- **WHEN** the modal's feed follows and pauses
- **THEN** it does so through the shared element-scoped follow the weaver chat and the session page already use, and no separate scroll-measurement code is added for it