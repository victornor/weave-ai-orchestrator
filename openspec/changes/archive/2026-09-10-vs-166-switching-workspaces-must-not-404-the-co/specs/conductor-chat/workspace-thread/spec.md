## Purpose

Keeps the web conductor chat's selected thread inside the active workspace so a
sidebar (or palette) switch loads that workspace's conversation instead of a 404.

## ADDED Requirements

### Requirement: The chat thread belongs to the active workspace

The web conductor chat SHALL select a thread that belongs to the workspace the
app is currently showing. Following a Chat link in another workspace's sidebar
group (or choosing that workspace from the phone list or the command palette)
SHALL show that workspace's web thread — its history, or the empty composer when
the thread has no messages — and SHALL NOT show an error page.

The chat SHALL NOT request messages for a thread id that belongs to a different
workspace. Thread ids are workspace-scoped; a thread of workspace A is not a
thread of workspace B.

Unsent composer drafts and the chat's reading position remain per-workspace as
they already are.

#### Scenario: Switching from one workspace's chat to another's

- **WHEN** the human is viewing workspace A's conductor chat and follows workspace
  B's Chat link
- **THEN** the chat shows B's thread (or the empty composer), not an error, and
  does not request messages using A's thread id

#### Scenario: Switching away and back

- **WHEN** the human leaves workspace A's chat for workspace B's chat and then
  returns to A's Chat link
- **THEN** A's thread is shown again, not B's

#### Scenario: A workspace with no web thread yet

- **WHEN** the human opens a workspace's chat that has no web thread
- **THEN** the app creates one for that workspace and shows the empty composer,
  without requesting messages for another workspace's thread

### Requirement: A cross-workspace messages 404 recovers without a reload

When the messages request fails because the thread is not found in the active
workspace, the chat SHALL drop that thread id, select or create this workspace's
web thread, and continue without a document reload.

A thread that belonged to this workspace and has since been deleted MAY still
404; that case is not recovered here.

#### Scenario: Messages 404 because the thread is another workspace's

- **WHEN** the chat has requested messages with a thread id that the active
  workspace does not have, and the response is not_found
- **THEN** the chat selects or creates this workspace's web thread and shows it,
  without requiring the human to reload the page

#### Scenario: A deleted thread of this workspace

- **WHEN** messages 404s for a thread that this workspace did own
- **THEN** the chat may still show the load error
