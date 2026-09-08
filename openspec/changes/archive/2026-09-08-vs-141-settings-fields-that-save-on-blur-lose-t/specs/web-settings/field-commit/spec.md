## Purpose

Defines how a free-text or number field on the Settings page commits an edit to the daemon, and how
the operator can tell whether that edit was saved, so that leaving the page — by reloading, navigating
away, backgrounding the app, or switching to another section — never silently discards a typed value.

## ADDED Requirements

### Requirement: A field commits without requiring blur to fire

Every Settings field that saves an edit (rather than an atomic selection such as a dropdown or a
toggle) SHALL offer at least one way to commit the current draft that does not depend on the browser
dispatching a blur event: pressing `Enter` while the field is focused, and an explicit save action that
is available whenever the field's draft differs from the last-saved value. The field MAY also commit on
blur, but blur SHALL NOT be the only way to commit.

#### Scenario: Enter commits the value

- **WHEN** the operator edits a Settings field and presses `Enter`
- **THEN** the current draft is sent to be saved, on a phone keyboard exactly as on a desktop keyboard

#### Scenario: An explicit save action is available while a field is dirty

- **WHEN** a Settings field's draft differs from its last-saved value
- **THEN** a visible action that commits the draft is available, without requiring the field to be
  blurred first

#### Scenario: The action is not offered when there is nothing to save

- **WHEN** a Settings field's draft is the same as its last-saved value
- **THEN** no save action is offered for it

### Requirement: The operator can tell whether an edit was saved without reloading

A Settings field that has been edited SHALL show, next to the field, whether the draft is unsaved,
being saved, saved, or failed to save, updated as that state changes, and readable without navigating
away and back or reloading the page.

#### Scenario: An unsaved edit is visibly unsaved

- **WHEN** the operator changes a field's value and has not yet committed it
- **THEN** the field visibly shows that the change is not yet saved

#### Scenario: A committed edit is visibly confirmed

- **WHEN** a commit succeeds
- **THEN** the field visibly shows that the value was saved, without the operator reloading or
  navigating away and back to check

### Requirement: Leaving the page does not silently discard a dirty field

Switching to another Settings section, or otherwise unmounting a field while it is dirty, SHALL commit
the pending draft rather than discarding it. Because a full page reload or the app being backgrounded
cannot be intercepted this way, the visible unsaved/saving/saved state required above is what makes the
outcome unmistakable in those cases: an operator who reloads while a field visibly shows "unsaved" is
told, at the moment they last looked at the screen, that the edit had not been saved.

#### Scenario: Switching sections commits a dirty field

- **WHEN** the operator has an uncommitted edit in a field and switches to another Settings section
- **THEN** the edit is committed before the field is removed from the page

#### Scenario: A reload leaves the unsaved state visible beforehand

- **WHEN** the operator edits a field and reloads the page before it is committed
- **THEN** the field showed an unsaved state at the time of the reload, rather than looking identical
  to a saved field

### Requirement: A rejected save keeps the typed value and states why

When a commit is rejected, the field SHALL keep showing the operator's typed draft — not the prior
saved value — and SHALL show why the save failed, so the value can be corrected and retried without
retyping it.

#### Scenario: A rejected save does not revert the field

- **WHEN** a commit is rejected by the daemon
- **THEN** the field continues to show the value the operator typed, and states that the save failed
  and why

#### Scenario: Retrying after a rejection reuses the same draft

- **WHEN** the operator corrects a value after a rejected save and commits again
- **THEN** the retry sends the corrected draft, with no need to retype the part that was already right
