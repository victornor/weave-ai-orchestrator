# conductor-chat/outbound-attachments Specification

## Purpose
Lets the weaver hand the human real files in a chat reply — one file, or several bundled into a
single named zip — read from an explicit, server-enforced allowlist of locations it may already read,
so that a convenience feature never becomes a way to exfiltrate anything else on the host.

## Requirements

### Requirement: The weaver can attach a single file to a reply

`ac_human_send` SHALL accept a list of up to four attachment entries. An entry naming one file path
SHALL attach that file to the outbound message, and the human SHALL be able to download it from the
chat with its original filename intact.

#### Scenario: Single file attached and downloaded

- **WHEN** the weaver sends a reply with one attachment entry naming an allowed file path
- **THEN** the message is created with that file attached, and the human can retrieve it through the
  chat with the same filename the path ended in

#### Scenario: A message with no attachments behaves exactly as before

- **WHEN** the weaver calls `ac_human_send` without an `attachments` parameter
- **THEN** the message is created exactly as it was before this capability existed

### Requirement: The weaver can bundle several files into one named zip

An attachment entry naming more than one file path SHALL be bundled into a single zip archive attached
to the message. The weaver SHALL be able to name the zip; when it does not, the zip's filename SHALL
default to a name that identifies it as a weaver handoff rather than a generic "files.zip". Inside the
zip, each file SHALL appear at a sensible path — its own base name, disambiguated when two bundled
files share a base name — so the archive opens with all of them intact.

#### Scenario: Several files bundled into a named zip

- **WHEN** the weaver sends a reply with one attachment entry naming three allowed file paths and a
  zip name
- **THEN** the message is created with one zip attachment under the given name, and the zip contains
  all three files at distinct paths inside it

#### Scenario: Zip name defaults to something identifying

- **WHEN** the weaver bundles files into a zip without naming it
- **THEN** the zip is attached under a default name that identifies it as coming from the weaver,
  never the literal name "files.zip"

#### Scenario: Bundled files with the same base name do not collide

- **WHEN** the weaver bundles two files that share a base name but live at different paths
- **THEN** the resulting zip contains both files, each at its own distinct path inside the archive

### Requirement: Only a file reachable through the outbound attachment allowlist may be attached

A file path given to `ac_human_send`'s attachment parameter SHALL be resolved to its real, symlink-
resolved location and checked against an explicit allowlist: the workspace's own `knowledge/` tree, the
workspace's `projects/` tree (every project's clone), or a worker's own `work/` worktree. A path that
does not resolve inside one of these, including a symlink that resolves outside them, SHALL be refused.
This check SHALL apply regardless of whether the entry is a single file or part of a zip bundle.

#### Scenario: A path outside the allowlist is refused by name

- **WHEN** the weaver names a file path that is not under the knowledge tree, a project's clone, or a
  worker's worktree
- **THEN** the request is refused with an error that names the specific path and states it is not
  attachable, and no message, attachment row, or zip is created

#### Scenario: The workspace's secrets file is refused

- **WHEN** the weaver names the workspace's secrets file (`secrets.enc` or `secrets.key`) as an
  attachment path
- **THEN** the request is refused for that specific path, exactly as any other disallowed path is

#### Scenario: The workspace's database is refused

- **WHEN** the weaver names the workspace's database file as an attachment path
- **THEN** the request is refused for that specific path, exactly as any other disallowed path is

#### Scenario: A path outside the workspace root is refused

- **WHEN** the weaver names a file path that exists on the host but is outside the workspace's root
  directory entirely
- **THEN** the request is refused for that specific path, exactly as any other disallowed path is

#### Scenario: A symlink cannot launder a disallowed path

- **WHEN** an allowed location contains a symlink whose real target resolves outside the allowlisted
  locations
- **THEN** naming that symlink's path is refused exactly as naming its real target directly would be

#### Scenario: A path inside a `.git` directory is refused even within an allowed root

- **WHEN** the weaver names a path with a `.git` path segment — the directory itself or anything
  under it — inside a project's clone or a worker's worktree
- **THEN** the request is refused for that path, naming it, exactly as a path outside the allowlist
  would be, because a clone's `.git` directory can carry a credential-bearing remote URL and the full
  object store

### Requirement: A rejected attachment fails the whole request, before anything is written

When any attachment entry in a request fails validation — an unreadable path, a path outside the
allowlist, or a path exceeding its size cap — SHALL cause the entire `ac_human_send` call to fail. No
message SHALL be created, no attachment row SHALL be written, and no zip SHALL be produced missing the
file that failed; validation of every named path SHALL complete before anything is written.

#### Scenario: One bad path among several fails the whole zip

- **WHEN** a zip bundle names three paths and one of them is outside the allowlist
- **THEN** the request fails naming that path, and no zip, attachment row, or message is created — not
  even one containing only the two valid files

#### Scenario: A bad path fails the message too

- **WHEN** a request carries a valid message body and one attachment entry that fails validation
- **THEN** the message is not created either; the human never sees a reply that silently dropped its
  attachment

### Requirement: Outbound attachments are capped in count and size

A request SHALL carry at most four attachment entries. Each individual file read for an attachment
SHALL be capped at a fixed size; the combined input to a single zip bundle SHALL be capped at a fixed,
larger size. A path exceeding its cap SHALL be refused by name, stating the cap.

#### Scenario: A single oversized file is refused

- **WHEN** the weaver names a file path whose size exceeds the single-file cap
- **THEN** the request is refused for that path, and the response states the cap

#### Scenario: A zip bundle exceeding the combined cap is refused

- **WHEN** the weaver bundles files whose combined size exceeds the zip input cap
- **THEN** the request is refused before any zip is built, and the response states the cap

### Requirement: A zip attachment is offered as a download, never rendered inline

An attachment of type `application/zip` SHALL be presented to the human as a clickable download
carrying its filename and size, and SHALL NOT be rendered inline the way an image attachment is.

#### Scenario: Zip renders as a download, not an image

- **WHEN** a message carries a zip attachment
- **THEN** the chat shows it as a named, sized download link, and never attempts to display it as an
  image

### Requirement: Only the weaver's reply path gains the ability to attach files

Attaching a file to an outbound message SHALL be available only through the weaver's reply tool. A
worker SHALL have no equivalent capability; this change SHALL NOT add any way for a worker to attach a
file to a ticket or elsewhere.

#### Scenario: A worker has no outbound attachment tool

- **WHEN** a worker's available tools are inspected
- **THEN** no tool lets it attach a file to an outbound message
