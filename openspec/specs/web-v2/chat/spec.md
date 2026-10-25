# web-v2/chat Specification

## Purpose
The V2 Chat screen: a workspace's conversation with the weaver, rendered in V2's Mono language, split
between the conversation and the open decisions it produced, under Chat's own status bar.

## Requirements

### Requirement: The conversation splits from the decisions it produced

On desktop, Chat SHALL render the conversation in a left column and the workspace's open decisions in a
right pane by default, each scrolling independently, with the decisions rendered as VS-345's
narrow-pane decision card. A draggable divider SHALL set the decisions pane's width between 300px and
560px, and the divider SHALL be operable with the keyboard. Below roughly 620px of the chat region's own
width the decisions pane SHALL drop out and the conversation SHALL take the full width. On a phone
there SHALL be no decisions pane. The width choice SHALL persist for the session.

#### Scenario: Desktop shows both panes

- **WHEN** the chat region is at least 620px wide and there is an open decision
- **THEN** the conversation renders on the left and the open decision as a narrow card in the right pane

#### Scenario: The divider resizes within its limits

- **WHEN** the human drags the divider left or right, or nudges it with the keyboard
- **THEN** the decisions pane resizes between 300px and 560px and never past either bound

#### Scenario: The pane drops out below the threshold

- **WHEN** the chat region narrows below about 620px
- **THEN** the decisions pane is not rendered and the conversation fills the width

#### Scenario: Phone chat has no decisions pane

- **WHEN** Chat is opened at phone width
- **THEN** no decisions pane is rendered and the conversation is full width

### Requirement: A decision can be answered from the pane

An open decision shown in the chat's decisions pane SHALL be answerable in place through the same answer
path the rest of V2 uses, including options, free text, inputs, and the held card's override. Answering
SHALL remove the decision from the open list once the daemon records it.

#### Scenario: Answering in the pane

- **WHEN** the human chooses an option on a decision in the pane and sends the answer
- **THEN** the answer is submitted for that decision and the card leaves the list of open decisions

#### Scenario: A refused answer is reported in the pane

- **WHEN** the daemon refuses an answer (the decision is stale, held, or otherwise cannot be recorded)
- **THEN** the pane shows the reason, in the human's terms for a stale card, and the card stays

### Requirement: Chat carries its own status bar

Chat SHALL render a 38px status bar in place of the generic screen header. The bar SHALL show the number
of workers running, the number of decisions needing the human, and the weaver session's usage — its limit
percent and when it resets — from the daemon account snapshot. Each figure SHALL be derived from the same
source as the screen that owns it (the worker list, the open-decision list, and `GET /usage/accounts`),
never from a separate literal or a second fetch.

#### Scenario: The bar reports its three figures

- **WHEN** the workspace has running workers, open decisions, and a metered weaver session
- **THEN** the status bar shows the running count, the needs-you count, and the session limit percent with its reset

#### Scenario: The counts agree with their sources

- **WHEN** the set of running workers or the set of open decisions changes
- **THEN** the status bar's figure changes with the same query the rest of the screen renders

### Requirement: Messages carry their metadata, with no avatar

Each message SHALL render its timestamp and, for a message a turn produced, the turn's token count. A
message the weaver sent SHALL offer a Reply affordance that sets the reply target for the next message,
sent as `replyToMessageId`, and the sent message SHALL show the quote of what it answers. No weaver
avatar or profile picture SHALL appear anywhere in Chat.

#### Scenario: A message shows time and tokens

- **WHEN** a weaver message with a recorded turn is rendered
- **THEN** its timestamp and the turn's token count are shown, and no avatar is rendered

#### Scenario: Replying to a message

- **WHEN** the human activates Reply on the weaver's message and sends a message
- **THEN** the outgoing message carries `replyToMessageId` and the conversation shows the quote it answers

### Requirement: A finished turn collapses to one summary line

A weaver message SHALL carry a collapsed summary line naming what its turn did — tool calls, duration,
tokens, and context size over the model's window — derived from the run's trace, usage and its model's
context window. The line SHALL be absent, not zeroed, for a quantity the runtime did not report. Opening
the line SHALL render the turn's trace.

#### Scenario: The summary line

- **WHEN** a finished turn made tool calls over some duration and spent tokens
- **THEN** its message shows a `▸ weaver did …` line with the tool-call count, duration, tokens and context size

#### Scenario: A run with no reported quantity

- **WHEN** the runtime reported no token usage for a turn
- **THEN** the summary line names only the quantities that exist and does not print a zeroed figure

#### Scenario: Opening the trace

- **WHEN** the human opens a message's summary line
- **THEN** the turn's trace is rendered from the run's events

### Requirement: Working traces are visually distinct from finished prose

The working trace SHALL render narration between tool calls in italic, at a dimmer ink than a finished
message. A tool row SHALL show the tool's name and its argument, and a result line SHALL be indented two
spaces under the call that produced it. Trace text that is markdown SHALL be rendered as markdown.

#### Scenario: Narration is dimmer and italic

- **WHEN** a trace contains narration text between two tool calls
- **THEN** that text renders italic in a dimmer ink than a finished message's prose

#### Scenario: A tool call and its result

- **WHEN** the trace holds a tool call and a result line
- **THEN** the row names the tool and its argument, and the result line is indented two spaces under it

### Requirement: Inline references and attachments render per kind

Ticket identifiers in a message body SHALL render as clickable bordered mono tags that open the
ticket; other literals SHALL stay code spans; page links SHALL read as underlined prose links. The
tag SHALL be produced by one shared linkifier used by every agent-text surface in the web app,
including the weaver chat, the planning chat and a persistent session's transcript, live streaming
text and trace narration; no surface SHALL add its own identifier pattern. An identifier that
appears inside an inline code span or a fenced code block SHALL stay literal code, exactly as
written, and SHALL NOT become a tag. A message's attachments SHALL render as rows beneath its body,
each with a glyph, its byline and its kind, with an image shown as a preview and a file linked for
download.

#### Scenario: A ticket reference is a tag

- **WHEN** a message body names a ticket identifier
- **THEN** it renders as a bordered mono tag that opens that ticket when clicked

#### Scenario: Literals and page links

- **WHEN** a message body contains an inline code literal and a link to a page
- **THEN** the literal stays a code span and the page link reads as underlined text

#### Scenario: An identifier inside a code span stays literal

- **WHEN** a message body contains a ticket identifier inside an inline code span or a fenced code block
- **THEN** it is rendered as the literal text that was written, as code, and is not a tag

#### Scenario: The tag comes from one shared linkifier

- **WHEN** agent text naming a ticket identifier is rendered on any agent-text surface, including the live stream and the trace
- **THEN** the tag is produced by the same shared linkifier the message body uses, not a surface-local pattern

#### Scenario: Attachment rows

- **WHEN** a message carries attachments
- **THEN** each renders as a row under the body with its glyph, byline and kind

### Requirement: A decision renders per width, and answered leaves a note

The channel manager pushes every human-owned decision to the thread as a card message whose prose
fallback is the decision's title and context. That message SHALL NOT render as a prose message at any
width. What renders where its card sits depends on width and on whether the decision is open:

- Where the decisions pane is **absent** — a phone, and any chat region below the split threshold —
  an **open** decision SHALL render the full, answerable decision card inline, through the same
  `V2DecisionCard` the pane uses, so it can be answered from the conversation. Answering it SHALL
  swap it in place to the note line below, the live update VS-369 gives the pane.
- Where the decisions pane is **present** (desktop), an **open** decision SHALL render nothing in the
  conversation; the pane beside it carries the card.
- An **answered** decision SHALL render exactly one small, muted, single-line note where its card
  sat, at every width: `You decided: <answer> — <decision title>` for an approval — a plan, merge,
  action, hire, discard or retry card — and `You answered: <answer> — <decision title>` for a
  question, concern or gate finding. The `<answer>` SHALL be the chosen option's label, else the
  first line of the free text. The note SHALL link to the decision's ticket, or to Needs you when the
  decision has no ticket.

The card-or-nothing choice SHALL use the same signal that shows or hides the decisions pane, and
SHALL NOT treat an unmeasured chat region as a phone: the inline card SHALL appear only once the
region is measured and below the threshold, so a desktop never flashes a card the pane then
replaces. This SHALL NOT remove, reorder or alter any real message, and Needs you SHALL continue to
show every open decision.

```text
You decided: Approve — Approve the plan for "Add response caching for the /projects list"
```

#### Scenario: Phone renders an open decision as an answerable card

- **WHEN** Chat is opened at phone width with an open decision pushed to the thread
- **THEN** the conversation renders that decision's full card where its message sits, with its options
  and a way to answer it, and no decisions pane

#### Scenario: Answering the inline card swaps it for the note

- **WHEN** the human answers the inline card on phone
- **THEN** the card is replaced in place by its one-line note without waiting for a list refetch

#### Scenario: Desktop renders nothing for an open decision

- **WHEN** the chat region is at least 620px wide with an open decision pushed to the thread
- **THEN** the conversation renders nothing for it and the decision renders as a card in the
  decisions pane

#### Scenario: An answered decision leaves one note line at both widths

- **WHEN** a decision pushed to the thread is answered and the conversation renders
- **THEN** exactly one note line appears where its card sat, carrying `You decided:` for an approval
  or `You answered:` for a question, the option's label or the text's first line, and the decision
  title — on phone and on desktop alike

#### Scenario: The note links to the decision's ticket or to Needs you

- **WHEN** an answered decision has a ticket
- **THEN** the note links to that ticket's page; when it has none, the note links to Needs you

#### Scenario: No desktop flash before the region is measured

- **WHEN** the chat region's width is not yet measured on the first render
- **THEN** no inline decision card is rendered, so a desktop never shows one before the pane takes
  over

#### Scenario: Real messages are untouched

- **WHEN** the thread holds ordinary weaver and human messages alongside a decision push
- **THEN** every ordinary message still renders, in order, with its metadata

### Requirement: Chat can be opened with a prompt already in the composer

The chat screen SHALL accept a one-shot seeded prompt handed to it by another screen and place that
text in the composer of the workspace's conversation, unsent and editable, once the conversation is
resolved — including when the conversation has to be created first. A seed SHALL be consumed once
and SHALL NOT reappear on a later visit or in another workspace, and it SHALL NOT send a message by
itself.

#### Scenario: A seeded prompt lands in the composer

- **WHEN** another screen opens the workspace's chat with a seeded prompt
- **THEN** the composer shows that prompt, unsent and editable, in that workspace's conversation

#### Scenario: The conversation is created for the seed

- **WHEN** the workspace has no conversation yet and chat is opened with a seed
- **THEN** the conversation is created and the seed is placed in its composer

#### Scenario: A seed is one-shot

- **WHEN** a seeded prompt has been shown and the person leaves and returns to chat
- **THEN** the prompt does not reappear unless it is sent as a draft

#### Scenario: A seed does not cross workspaces

- **WHEN** a prompt is seeded for one workspace
- **THEN** no other workspace's composer shows it

### Requirement: Chat renders a tab strip with the weaver conversation as a tab

The V2 Chat screen SHALL render a tab strip above the conversation area. The weaver conversation
SHALL be a tab, selected when the screen opens unless a plan tab was the last-focused tab in the
workspace, and the weaver tab SHALL render the screen's existing status bar, conversation,
decisions pane and composer unchanged. The strip SHALL carry a **New plan** control and one tab per
drafting plan in the workspace, each tagged with its project, as specified by
`planning-sessions/v2-modal`.

#### Scenario: The weaver tab is present and selected

- **WHEN** Chat is opened with no plan tab remembered as focused
- **THEN** the strip's first tab is the weaver conversation and it is the selected tab

#### Scenario: The weaver tab renders today's chat

- **WHEN** the weaver tab is selected
- **THEN** the status bar, conversation, decisions pane and composer render exactly as they did
  before the tab strip existed

#### Scenario: The strip carries the plan tabs and New plan

- **WHEN** the workspace has drafting plans, across one or more projects
- **THEN** the strip shows a tab per drafting plan after the weaver tab, each tagged with its
  project, and a **New plan** control

### Requirement: The tab strip never overflows at narrow widths

The tab strip SHALL scroll horizontally when its tabs exceed the available width and SHALL NOT wrap
or push the **New plan** control out of reach. On a phone-sized viewport the tabs SHALL remain
selectable by scrolling the strip, and the conversation area SHALL keep the width it had with a
single tab.

#### Scenario: Many tabs on a narrow screen

- **WHEN** several plan tabs are open at a phone-sized viewport
- **THEN** the strip scrolls horizontally, its tabs stay selectable, and the page does not overflow

#### Scenario: The New plan control stays reachable

- **WHEN** the tab strip is too narrow to show every tab
- **THEN** the **New plan** control remains reachable without scrolling past the last tab

### Requirement: The decisions pane collapses when nothing is waiting and stays reachable

On desktop — a chat region at least as wide as the split threshold — when no decision is open and the
reader has not deliberately expanded it, Chat SHALL render the decisions pane collapsed to a narrow
right rail rather than holding its full column, and the conversation SHALL take the width the pane
gives up. The collapsed rail SHALL offer a visible, keyboard-operable control that expands the pane
again, so that a collapsed pane is never unreachable, and the expanded pane SHALL offer a control that
collapses it again while nothing is waiting.

The collapse SHALL follow the number of open decisions currently held, never a snapshot taken when the
chat opened: an open decision that appears while the chat is rendered SHALL expand the pane to its
full width without a reload, and answering the last open decision SHALL return the pane to its
collapsed state on its own. A pane the reader expanded by hand while nothing was waiting SHALL remain
expanded until they collapse it or until an open decision arrives and is afterwards answered.

The width change SHALL be animated through the chat's existing motion durations, so the conversation
does not reflow abruptly, and SHALL become an instant step when the reader has asked for reduced
motion. Below the split threshold, and on a phone, neither the pane nor a collapsed rail SHALL render,
exactly as before.

#### Scenario: Nothing waiting on a wide screen

- **WHEN** the chat region is at least as wide as the split threshold and no decision is open
- **THEN** the decisions pane is rendered collapsed to its narrow rail, the conversation takes the
  reclaimed width, and the rail's expand control is present

#### Scenario: A decision arriving expands the pane without a reload

- **WHEN** the chat is rendered on a wide screen with the pane collapsed and an open decision arrives
- **THEN** the pane expands to its full width and shows the decision, without the page reloading

#### Scenario: The last decision answered collapses the pane again

- **WHEN** the last open decision is answered on a wide screen
- **THEN** the pane returns to its collapsed rail on its own, and the conversation takes the reclaimed
  width

#### Scenario: A deliberately expanded empty pane stays reachable

- **WHEN** the chat is on a wide screen with no decision open and the reader activates the rail's
  expand control
- **THEN** the pane expands and shows its empty state, and activating the pane's collapse control
  returns it to the rail

#### Scenario: The collapse follows the count, not the mount

- **WHEN** the chat opens with no decisions, a decision then arrives, and it is answered
- **THEN** the pane is collapsed at first, expands when the decision arrives, and collapses again when
  it is answered — all without a reload

#### Scenario: Below the threshold there is no pane and no rail

- **WHEN** the chat region narrows below the split threshold
- **THEN** neither the decisions pane nor the collapsed rail is rendered and the conversation takes
  the width, as before

#### Scenario: Phone chat is unchanged

- **WHEN** Chat is opened at phone width
- **THEN** no decisions pane and no collapsed rail are rendered, and an open decision renders inline in
  the conversation as before

#### Scenario: Reduced motion collapses the animation

- **WHEN** the reader has asked for reduced motion and the pane changes between its collapsed and
  expanded states
- **THEN** the change is an instant step rather than an animated width transition

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

### Requirement: Weaver messages carry a live ticket-status strip

The V2 Chat conversation SHALL render, under each weaver message that references tickets, the compact
ticket-status strip specified by `conductor-chat/dispatch-labels`: one wrapped row of chips, at most
six with a `+N more` chip that expands the rest in place. The strip SHALL render nothing, and reserve
no height, under a message that references no ticket.

Each chip SHALL carry the ticket identifier, the acting name and the ticket's current status with the
existing status glyph and hue, and SHALL activate through the same shared ticket link handler the
message's inline identifiers use, so a chip opens the ticket modal on desktop and navigates on phone
with no second handler written for it.

The strip SHALL be part of the message's block: a chip appearing or changing status under the newest
message SHALL NOT pull a reader who has scrolled up back to the bottom, and SHALL NOT cause a layout
jump. The strip SHALL be rendered wherever the weaver conversation is shown through the shared
conversation component — the Chat screen and each pane of the global chats — and SHALL NOT be
rendered in a planner chat or a worker/session transcript.

#### Scenario: A message that filed a ticket and a message that only mentions tickets

- **WHEN** the conversation shows one weaver message that filed a ticket and another that merely names two existing tickets
- **THEN** each of those messages carries its own strip under it, and a weaver message referencing no ticket carries none

#### Scenario: A chip opens the same modal an identifier does

- **WHEN** the human activates a chip in the strip on a desktop viewport
- **THEN** the ticket modal opens, exactly as activating the identifier in the message text does

#### Scenario: A chip on phone navigates

- **WHEN** the human activates a chip on a phone viewport
- **THEN** the ticket page opens, as it does for an identifier in the text

#### Scenario: No strip, no reserved height

- **WHEN** a weaver message references no ticket
- **THEN** no empty strip or spacer is rendered under it

#### Scenario: A chip changing status does not yank a reader who scrolled up

- **WHEN** the human has scrolled up and a chip under a message changes its status
- **THEN** the view stays where it is and no layout jump occurs

#### Scenario: The global chats show the strip, the planner chat does not

- **WHEN** a workspace is shown as a pane of the global chats, and a plan tab's planner chat is shown
- **THEN** the weaver conversation in the pane carries the strip and the planner chat does not

### Requirement: An expanded ticket chip shows a bounded live feed inline

Under the ticket-status strips specified by `conductor-chat/dispatch-labels`, an expanded chip's
panel SHALL render inside the message's own block, directly beneath the chip row, at the message's
width.

The panel SHALL be capped at about ten text lines and SHALL hold its own scroll inside that cap, so
long content scrolls in the panel and never scrolls the chat. A feed shorter than the cap SHALL
render at its content height — about six to ten lines is the intended range with content — and SHALL
never be a tall empty box.

The panel SHALL follow its newest content while the reader is at its bottom, through the shared
element-scoped follow the chat and the ticket modal already use in its contained mode — the panel
moves its own scroll offset only — and SHALL pause the follow when the reader scrolls up inside it.
New content arriving in the panel SHALL NOT move the chat; a reader at the bottom of the chat SHALL
be kept there by the chat's existing follow as the message block grows.

Expanding or collapsing a panel SHALL grow or shrink the message block by the panel's height alone,
without a layout jump and without shifting a reader who has scrolled up. The closing transition when
a panel auto-collapses SHALL be short and calm, and SHALL be skipped under reduced motion.

The panel SHALL render wherever the strip renders — the Chat screen and each pane of the global chats
— and SHALL NOT be rendered in a planner chat or in a worker/session transcript. On a phone viewport
the same control and panel SHALL render at the message's width with a touch-sized control.

#### Scenario: The panel sits under the chip row

- **WHEN** the human expands a chip
- **THEN** its feed renders directly beneath the chip row, within the same message block, at the
  message's width

#### Scenario: A long feed scrolls inside the panel

- **WHEN** an expanded ticket's feed is longer than the panel's cap
- **THEN** the panel grows no taller than about ten lines and the extra content scrolls inside it,
  leaving the chat's scroll position unaffected

#### Scenario: A short feed is content height

- **WHEN** an expanded ticket's feed holds a single line
- **THEN** the panel is that content's height rather than a tall empty box

#### Scenario: Scrolling up inside the panel pauses its follow

- **WHEN** the human scrolls up inside an expanded panel while new content arrives
- **THEN** the panel stays where they put it and the chat behind it does not move

#### Scenario: A new line does not move the chat

- **WHEN** new output arrives in an expanded panel while the reader is scrolled up in the chat
- **THEN** the chat's scroll position is unchanged and no layout jump occurs

#### Scenario: Reduced motion skips the closing transition

- **WHEN** reduced motion is set and an expanded panel auto-collapses
- **THEN** the panel is removed without the transition, the feed unmounting immediately

#### Scenario: Phone keeps the same control and panel

- **WHEN** the chat is shown at phone width
- **THEN** each chip carries the same expand control with a touch-sized hit target, and the panel
  opens at the message's width

#### Scenario: The global chats show the panel, the planner chat does not

- **WHEN** a workspace is shown as a pane of the global chats, and a plan tab's planner chat is shown
- **THEN** a chip in the pane expands to its inline panel and the planner chat renders none

### Requirement: The conversation column shares one widening measure

Chat's message column and its composer SHALL use one reading measure, resolved from the chat region's
own width, so the two never disagree and neither carries its own fixed pixel cap. While the region is
narrow the measure SHALL stay at the reading width, so text does not stretch into an unreadable line on a
usual desktop. Once the region is wide — which is what a pane of a side-by-side Chats row on a very wide
screen has — the measure SHALL widen with the region up to a bounded maximum, so the column uses the
pane instead of centring a narrow strip in it. The measure SHALL be a function of the region's width
only: the same region width SHALL always resolve to the same measure, regardless of viewport, device
pixel ratio or a sibling pane.

#### Scenario: A narrow region keeps the reading width

- **WHEN** the chat region is narrower than the widening threshold
- **THEN** the message column and composer are centred at the reading width and do not stretch

#### Scenario: A wide region widens the column

- **WHEN** the chat region is wider than the widening threshold
- **THEN** the message column and composer are wider than the reading width and centred in the region

#### Scenario: The measure is bounded

- **WHEN** the chat region grows past the point where the measure reaches its maximum
- **THEN** the column stops widening and stays centred

#### Scenario: The column uses the pane it is given

- **WHEN** a pane of the side-by-side Chats row is approximately half of a 5120 px-wide window
- **THEN** the message column and composer are substantially wider than the reading width, rather than a
  narrow strip centred in the pane

#### Scenario: A collapsed or hidden decisions pane does not change the measure

- **WHEN** the decisions pane opens, closes or is resized
- **THEN** the conversation column's measure is unchanged, because it follows the chat region's width
