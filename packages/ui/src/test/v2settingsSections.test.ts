/** The V2 Settings section registry (VS-348): the two scopes and the section resolution. */
import { describe, expect, it } from 'vitest';
import { V2_DAEMON_SECTIONS, V2_WORKSPACE_SECTIONS, firstSectionOf, scopeFromSearch, sectionFor, sectionsOfScope } from '../v2/settings/sections';

describe('the V2 settings section registry', () => {
  it('lists the daemon sections and the kept V1 ones, with no Budget tab', () => {
    const keys = V2_DAEMON_SECTIONS.map((s) => s.key);
    expect(keys).toEqual(['updates', 'models', 'security', 'host-tools', 'dictation', 'device']);
    expect(keys).not.toContain('budget');
  });

  it('lists the workspace sections and the kept V1 ones, with no Budget tab', () => {
    const keys = V2_WORKSPACE_SECTIONS.map((s) => s.key);
    expect(keys).toEqual(['general', 'weaver', 'models', 'projects', 'knowledge', 'worker-memory', 'approvals', 'channels', 'presentation', 'plugins']);
    expect(keys).not.toContain('budget');
  });

  it('resolves every listed section to itself and falls back for an unknown one', () => {
    for (const s of V2_DAEMON_SECTIONS) expect(sectionFor('daemon', s.key).key).toBe(s.key);
    for (const s of V2_WORKSPACE_SECTIONS) expect(sectionFor('workspace', s.key).key).toBe(s.key);
    expect(sectionFor('daemon', 'nope').key).toBe(firstSectionOf('daemon').key);
    expect(sectionFor('workspace', undefined).key).toBe(firstSectionOf('workspace').key);
  });

  it('shows the daemon when no scope is named and a workspace when one is', () => {
    expect(scopeFromSearch({})).toBe('daemon');
    expect(scopeFromSearch({ scope: '  ' })).toBe('daemon');
    expect(scopeFromSearch({ scope: 'acme' })).toBe('workspace');
  });

  it('gives each scope its own section list', () => {
    expect(sectionsOfScope('daemon')).not.toEqual(sectionsOfScope('workspace'));
  });
});
