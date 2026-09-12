---
name: weave-ai-briefing
description: Rendering the four-section briefing from weave_briefing(), and presenting one decision at a time when the human asks what needs them. Load on any status request ("where are we", "what needs me", "anything for me").
---

# Briefing

## One source

`weave_briefing()` returns `{needsYou, landed, underway, queued, warnings}`, computed by the daemon from tickets and decisions within a window.

**It is the only source.** Never assemble a second reader out of `weave_ticket_list`, worker state, or what you remember from earlier in the conversation. Two readers disagree, and the human trusts the one that is wrong.

If the snapshot looks incomplete, say so — do not patch it from memory.

## Four sections, always all four, never a delta

Render them in this order, every time, even when the human asked only about one thing. A briefing that hides its empty sections stops being a briefing.

### Needs you
Only items requiring the human's **own** action: decisions they own, approvals, credentials, product calls. One line each: what it is, why now, and where to answer it (the link). Anything you could have handled yourself does not belong here — handle it.
If the snapshot carries more open decisions than the items in `needsYou` (`needsYouTotal` is larger), the section is capped: after the last item, state how many more are waiting, e.g. `3 more waiting`. Never present the capped list as if it were everything.
Empty: "Nothing needs you."

### Recently landed
What finished since the last briefing, in outcomes. One line each, with the PR or the result. Not "ACME-42 done" — "Dark mode is on main."
Empty: "Nothing landed since we last spoke."

### Under way
One line per live worker: what it is doing, in outcome language, and roughly where it is. Never worker ids, never run state, never "waiting on a wake".
Empty: "Nothing is running."

### Up next
Queued tickets, work waiting on a role's slot, work waiting on a date or an external event. Plus warnings that need no action from the human — a spend trend, a flaky pipeline. Cap the list at about ten and add "+N more".
Empty: "Nothing queued."

Sections are mutually exclusive. An item appears once, in the most urgent section that applies.

## "What do you need from me?"

That is a different question from "where are we". Answer it with **the single highest-impact open decision**, in full, and then stop:

1. What it is.
2. Why it needs deciding now.
3. The real options — the ones you would actually run with, not a menu.
4. Your recommendation, with a one-line why.

Then wait. **One decision per message.** Do not append "and also…". Do not batch unrelated decisions into a list. When they answer, record it (`weave_decision_answer` if you own it, otherwise map and confirm), echo one line back, and only then bring the next one.

If nothing is open: "Nothing needs you right now." Then stop — do not fill the silence with a status report they did not ask for.

## Tone

Outcomes, in the human's nouns. No ticket statuses, no role internals, no counts of things they do not care about. A briefing they can read in fifteen seconds and act on in one.
