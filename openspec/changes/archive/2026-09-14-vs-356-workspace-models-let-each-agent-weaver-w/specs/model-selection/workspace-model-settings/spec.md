## ADDED Requirements

### Requirement: A workspace model write names the controls it changes

`PUT /api/w/:ws/models` SHALL treat each of its three controls (`weaver`, `workers`,
`workerOptions`) independently:

- a `ModelSetting` value SHALL override that control for the workspace;
- `null` SHALL clear the workspace's stored value for that control and leave it to inherit;
- omitting the key SHALL leave the workspace's stored value for that control unchanged.

For `workerOptions`, an array SHALL replace the workspace's catalog, and `null` (or an empty array)
SHALL clear it so the workspace inherits the daemon catalog.

Only the controls actually named SHALL be written; a control that is omitted SHALL keep its stored
value exactly. A body naming only `weaver` SHALL leave `workers` unconfigured when it was
unconfigured, so the workspace keeps following the daemon overlay for the control it did not touch.
A body carrying both `weaver` and `workers` and omitting `workerOptions` SHALL behave exactly as it
did before this change. A write that is applied SHALL still restamp the conductor, release login
pauses for runtimes the workspace has abandoned, and record the activity and update event with the
before and after values.

#### Scenario: Setting one agent leaves the other untouched

- **WHEN** a `PUT` names only `weaver` with a setting, and the workspace had no stored `workers`
- **THEN** the stored `workers` remains unset, and the effective `workers` still follows the daemon
  overlay (or the default when the overlay is empty)

#### Scenario: Null clears one control back to inherit

- **WHEN** a `PUT` sends `null` for a stored `weaver` and the daemon holds a weaver overlay
- **THEN** the workspace's stored `weaver` is cleared and its effective `weaver` becomes the daemon
  overlay's value; when the overlay is empty, the effective value becomes the schema default

#### Scenario: An omitted control keeps its stored value

- **WHEN** a `PUT` omits `workers` and the workspace has a stored `workers`
- **THEN** the stored `workers` is unchanged

#### Scenario: Null worker options inherit the daemon catalog

- **WHEN** a `PUT` sends `workerOptions: null` and the daemon has a catalog overlay
- **THEN** the workspace's stored catalog is cleared and the effective catalog is the daemon's

#### Scenario: An old two-field body behaves as before

- **WHEN** a `PUT` carries `weaver` and `workers` and omits `workerOptions`
- **THEN** both settings are written and any stored catalog is kept, exactly as the pre-change
  endpoint behaved

### Requirement: Each model control reports whether it is inherited

Reads of a workspace's model settings SHALL report, additively and for each of `weaver`, `workers`
and `workerOptions`, where the effective value comes from: `'workspace'` when the workspace has
stored its own value for that control, `'daemon'` when it has not but a daemon overlay is filled,
and `'default'` otherwise. For `workerOptions`, a stored non-empty catalog is `'workspace'` and an
empty or absent one falls through to the daemon catalog or the default.

The effective values the read already returns SHALL be unchanged, so an existing consumer that reads
only them is unaffected. The same sourced view SHALL be returned by a write, so a client that
replaces its cached read with the write's response keeps the source information.

#### Scenario: A stored control reads as the workspace's

- **WHEN** a workspace has configured its own `weaver` and the read is taken
- **THEN** the response carries the effective `weaver` and a source of `'workspace'` for it

#### Scenario: An unset control reads as the daemon's or the default's

- **WHEN** a workspace has no stored `workers` and a daemon workers overlay is filled, and then the
  overlay is cleared
- **THEN** the source is `'daemon'` while the overlay is filled and `'default'` after it is cleared

#### Scenario: An inherited value equal to the workspace's is still inherited

- **WHEN** a workspace has not stored `weaver` and the effective weaver happens to equal the daemon
  default
- **THEN** the source reports `'daemon'` or `'default'`, never `'workspace'`

#### Scenario: The write returns the same sourced view

- **WHEN** a `PUT` writes a workspace control
- **THEN** its response carries the effective values and the per-control source, matching the next
  read

### Requirement: Each client can clear one control and shows its source

The web app's workspace Models section and the command line SHALL each send only the control the
operator changed, so editing one agent never pins another. Each SHALL show, for every control,
whether the value is the workspace's own or inherited, and SHALL offer a way to clear a
workspace-set control back to inherit:

- the web app SHALL offer a "Use daemon default" action on a workspace-set control, which clears
  just that control;
- the command line SHALL print each control's source in its show command, SHALL send only the
  changed control from its set command, and SHALL offer a command that clears one control back to
  inherit.

#### Scenario: The web section sends only what changed

- **WHEN** the operator changes the workers setting in the web app's workspace Models section
- **THEN** the write names only `workers`, and the workspace's stored `weaver` is left as it was

#### Scenario: The web action clears one control

- **WHEN** a control shows as the workspace's own and the operator chooses "Use daemon default"
- **THEN** a write clearing only that control is made, and the control then reads as inherited

#### Scenario: The command line sets one control

- **WHEN** the operator runs a set command for one agent
- **THEN** the request names only that control, and the other agent is not pinned

#### Scenario: The command line clears one control

- **WHEN** the operator runs the inherit command for an agent or the option catalog
- **THEN** the request clears only that control and it follows the daemon or the default again

#### Scenario: The command line shows the source

- **WHEN** the operator runs the model show command
- **THEN** each control is printed with the value it resolves to and whether it is the workspace's,
  the daemon's or the default's
