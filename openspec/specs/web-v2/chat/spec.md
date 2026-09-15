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

### Requirement: The decisions pane is present whenever the layout is split

Whenever the chat region is wide enough to split, the decisions pane SHALL be rendered even when no
decision is waiting, showing an empty state rather than disappearing. The pane SHALL NOT appear or
vanish as the number of open decisions changes.

#### Scenario: Nothing waiting on a wide screen

- **WHEN** the chat region is at least 620px wide and no decision is open
- **THEN** the decisions pane renders with an empty state

#### Scenario: The layout does not jump when the last card is answered

- **WHEN** the last open decision is answered on a wide screen
- **THEN** the pane remains in place showing its empty state instead of vanishing

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

Ticket identifiers in a message body SHALL render as clickable bordered mono tags that open the ticket;
other literals SHALL stay code spans; page links SHALL read as underlined prose links. A message's
attachments SHALL render as rows beneath its body, each with a glyph, its byline and its kind, with an
image shown as a preview and a file linked for download.

#### Scenario: A ticket reference is a tag

- **WHEN** a message body names a ticket identifier
- **THEN** it renders as a bordered mono tag that opens that ticket when clicked

#### Scenario: Literals and page links

- **WHEN** a message body contains an inline code literal and a link to a page
- **THEN** the literal stays a code span and the page link reads as underlined text

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
