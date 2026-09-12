import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findUndeclaredCapabilityRetirements } from './retirement.js';

// Fixtures below reuse the real shape of VS-285's own change (the case that wedged archive):
// `runtime-credentials/serialized-refresh`'s main spec has exactly the 3 requirements its delta's
// sole `## REMOVED Requirements` section names, and `single-credential`'s delta only ever
// `## MODIFIED Requirements` one of its 4.

let dir: string | null = null;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = null; });

function setup(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), 'ac-retirement-'));
  for (const [path, body] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
  }
  return dir;
}

const SERIALIZED_REFRESH_MAIN = `# runtime-credentials/serialized-refresh Specification

## Purpose
Defines how at most one credential refresh is in flight per runtime per host.

## Requirements

### Requirement: At most one credential refresh is in flight per runtime per host
The system SHALL ensure at most one refresh is in flight per runtime per host.

#### Scenario: A burst of spawns causes one refresh
- **WHEN** several agents need to spawn at once
- **THEN** exactly one refresh is performed

### Requirement: A turn spawns only once its credential is confirmed to outlast it
The system SHALL confirm the credential outlasts the turn before spawning it.

#### Scenario: A near-expiry credential is refreshed first
- **WHEN** the credential would expire before the turn's timeout
- **THEN** the turn waits for a refresh

### Requirement: A refresh that cannot restore a working credential is one authentication failure, not several
Every agent waiting on a failed shared refresh SHALL be treated as one authentication failure.

#### Scenario: A failed shared refresh gates the runtime once
- **WHEN** the shared refresh cannot restore a working credential
- **THEN** the runtime is gated once, not per waiting agent
`;

const SERIALIZED_REFRESH_DELTA_ALL_REMOVED = `## REMOVED Requirements

### Requirement: At most one credential refresh is in flight per runtime per host

**Reason**: No daemon-initiated refresh is left to serialize.

**Migration**: None.

### Requirement: A turn spawns only once its credential is confirmed to outlast it

**Reason**: The freshness check forced credential rotation ahead of natural need.

**Migration**: A turn that cannot authenticate reports it through the runtime's own output.

### Requirement: A refresh that cannot restore a working credential is one authentication failure, not several

**Reason**: There is no shared refresh outcome left to report.

**Migration**: Each turn's own authentication failure is already reported by the runtime adapter.
`;

const SINGLE_CREDENTIAL_MAIN = `# runtime-credentials/single-credential Specification

## Purpose
Defines the one shared credential per runtime per host.

## Requirements

### Requirement: One credential per runtime per host
The system SHALL keep one credential file per runtime per host.

#### Scenario: Two agents share the same file
- **WHEN** two agents use the same runtime on the same host
- **THEN** they read and write the same credential file

### Requirement: A repair of the shared credential is monotonic in the credential's own expiry
A repair SHALL never replace a later-expiring credential with an earlier-expiring one.

#### Scenario: An older credential never wins
- **WHEN** a repair would replace a credential with an older one
- **THEN** the repair is skipped

### Requirement: An authentication failure never rewrites the credential
An authentication failure SHALL NOT modify the shared credential file.

#### Scenario: A failed turn leaves the credential untouched
- **WHEN** a turn fails to authenticate
- **THEN** the shared credential file is unchanged

### Requirement: An existing workspace credential is adopted once, not discarded
A workspace's own existing credential SHALL be adopted rather than overwritten on first use.

#### Scenario: First use adopts, it does not overwrite
- **WHEN** a workspace already has a credential file when a runtime first runs
- **THEN** that file is adopted rather than replaced
`;

const SINGLE_CREDENTIAL_DELTA_ONE_MODIFIED = `## MODIFIED Requirements

### Requirement: A repair of the shared credential is monotonic in the credential's own expiry
A repair SHALL never replace a later-expiring credential with an earlier-expiring one, and SHALL
also never replace it based on modification time alone.

#### Scenario: An older credential never wins
- **WHEN** a repair would replace a credential with an older one
- **THEN** the repair is skipped

#### Scenario: Modification time does not decide
- **WHEN** a candidate credential has a newer file modification time but an earlier expiry
- **THEN** the repair is skipped
`;

describe('findUndeclaredCapabilityRetirements', () => {
  it('flags a capability whose delta removes every requirement it has, when retire_capabilities is not set', () => {
    const cwd = setup({
      'openspec/specs/runtime-credentials/serialized-refresh/spec.md': SERIALIZED_REFRESH_MAIN,
      'openspec/changes/vs-285/.openspec.yaml': 'schema: spec-driven\n',
      'openspec/changes/vs-285/specs/runtime-credentials/serialized-refresh/spec.md': SERIALIZED_REFRESH_DELTA_ALL_REMOVED,
    });
    const issues = findUndeclaredCapabilityRetirements(cwd, 'vs-285');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.level).toBe('error');
    expect(issues[0]?.message).toContain("'runtime-credentials/serialized-refresh'");
    expect(issues[0]?.message).toContain('retire_capabilities: true');
  });

  it('does not flag the same delta once retire_capabilities: true is declared', () => {
    const cwd = setup({
      'openspec/specs/runtime-credentials/serialized-refresh/spec.md': SERIALIZED_REFRESH_MAIN,
      'openspec/changes/vs-285/.openspec.yaml': 'schema: spec-driven\nretire_capabilities: true\n',
      'openspec/changes/vs-285/specs/runtime-credentials/serialized-refresh/spec.md': SERIALIZED_REFRESH_DELTA_ALL_REMOVED,
    });
    expect(findUndeclaredCapabilityRetirements(cwd, 'vs-285')).toEqual([]);
  });

  it('does not flag a delta that only modifies some of a capability\'s requirements', () => {
    const cwd = setup({
      'openspec/specs/runtime-credentials/single-credential/spec.md': SINGLE_CREDENTIAL_MAIN,
      'openspec/changes/vs-285/.openspec.yaml': 'schema: spec-driven\n',
      'openspec/changes/vs-285/specs/runtime-credentials/single-credential/spec.md': SINGLE_CREDENTIAL_DELTA_ONE_MODIFIED,
    });
    expect(findUndeclaredCapabilityRetirements(cwd, 'vs-285')).toEqual([]);
  });

  it('does not flag a brand-new capability with no existing main spec', () => {
    const cwd = setup({
      'openspec/changes/vs-1/.openspec.yaml': 'schema: spec-driven\n',
      'openspec/changes/vs-1/specs/new-thing/spec.md': '## Purpose\n\nA new thing.\n\n## ADDED Requirements\n\n### Requirement: It exists\nThe system SHALL have a new thing.\n\n#### Scenario: It is there\n- **WHEN** asked\n- **THEN** it answers\n',
    });
    expect(findUndeclaredCapabilityRetirements(cwd, 'vs-1')).toEqual([]);
  });

  it('does not flag a capability whose every requirement is renamed rather than removed', () => {
    const cwd = setup({
      'openspec/specs/solo/spec.md': '# solo Specification\n\n## Purpose\n\nOne requirement.\n\n## Requirements\n\n### Requirement: Old name\nThe system SHALL do the thing.\n\n#### Scenario: It happens\n- **WHEN** asked\n- **THEN** it does the thing\n',
      'openspec/changes/vs-2/.openspec.yaml': 'schema: spec-driven\n',
      'openspec/changes/vs-2/specs/solo/spec.md': '## RENAMED Requirements\n- FROM: `### Requirement: Old name`\n- TO: `### Requirement: New name`\n',
    });
    expect(findUndeclaredCapabilityRetirements(cwd, 'vs-2')).toEqual([]);
  });
});
