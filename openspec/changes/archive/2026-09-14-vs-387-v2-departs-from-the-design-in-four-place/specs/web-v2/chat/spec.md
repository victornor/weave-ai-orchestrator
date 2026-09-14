## ADDED Requirements

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
