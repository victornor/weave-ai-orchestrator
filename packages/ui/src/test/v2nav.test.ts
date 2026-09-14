/** The V2 destination registry: the scope rule and the single-highlight rule, as pure functions. */
import { describe, expect, it } from 'vitest';
import {
  V2_EVERYWHERE,
  V2_KEPT,
  V2_WORKSPACE,
  activeNavKey,
  projectRowKey,
  v2Href,
  workspaceFromV2Path,
} from '../v2/nav';

describe('scope from a V2 path', () => {
  it('reads the workspace out of a workspace path', () => {
    expect(workspaceFromV2Path('/v2/w/acme/work')).toBe('acme');
    expect(workspaceFromV2Path('/v2/w/acme')).toBe('acme');
    expect(workspaceFromV2Path('/v2/w/acme/tickets/ACME-1')).toBe('acme');
  });

  it('is Everywhere for a path that names no workspace', () => {
    expect(workspaceFromV2Path('/v2/needs')).toBeNull();
    expect(workspaceFromV2Path('/v2')).toBeNull();
    expect(workspaceFromV2Path('/v2/chats')).toBeNull();
  });
});

describe('the single highlighted row', () => {
  it('highlights the global row on a global path', () => {
    expect(activeNavKey('/v2/needs')).toBe('global-needs');
    expect(activeNavKey('/v2/live')).toBe('global-live');
    expect(activeNavKey('/v2/chats')).toBe('global-chats');
    expect(activeNavKey('/v2/runs')).toBe('global-runs');
    expect(activeNavKey('/v2/runs/01ABC')).toBe('global-runs');
  });

  it('highlights the workspace row on a workspace path', () => {
    expect(activeNavKey('/v2/w/acme/chat')).toBe('ws-chat');
    expect(activeNavKey('/v2/w/acme/needs')).toBe('ws-needs');
    expect(activeNavKey('/v2/w/acme/work')).toBe('ws-work');
    expect(activeNavKey('/v2/w/acme/roles')).toBe('ws-roles');
    expect(activeNavKey('/v2/w/acme/knowledge')).toBe('ws-knowledge');
  });

  it('maps a drill-down to the destination that owns it', () => {
    expect(activeNavKey('/v2/w/acme/tickets/ACME-1')).toBe('ws-work');
    expect(activeNavKey('/v2/w/acme/workers/w1')).toBe('ws-roles');
    expect(activeNavKey('/v2/w/acme/artifacts/a1')).toBe('ws-knowledge');
    expect(activeNavKey('/v2/w/acme/p/web')).toBe(projectRowKey('web'));
  });

  it('is null where nothing owns the path', () => {
    expect(activeNavKey('/v2')).toBeNull();
    expect(activeNavKey('/v2/w/acme/nonsense')).not.toBeNull();
  });
});

describe('addresses preserve scope', () => {
  const work = V2_WORKSPACE.find((d) => d.key === 'ws-work')!;
  const needs = V2_EVERYWHERE.find((d) => d.key === 'global-needs')!;

  it('fills $ws from the current workspace scope', () => {
    expect(v2Href(work, { kind: 'workspace', ws: 'acme' })).toBe('/v2/w/acme/work');
  });

  it('fills $ws from the fallback when the scope is Everywhere', () => {
    expect(v2Href(work, { kind: 'everywhere' }, 'acme')).toBe('/v2/w/acme/work');
  });

  it('leaves a global address alone', () => {
    expect(v2Href(needs, { kind: 'workspace', ws: 'acme' }, 'acme')).toBe('/v2/needs');
  });
});

describe('the registry matches the design', () => {
  it('names the workspace section Work, not Board', () => {
    expect(V2_WORKSPACE.map((d) => d.label)).toEqual(['Chat', 'Needs you', 'Work', 'Roles', 'Knowledge']);
  });

  it('lists Everywhere above the workspaces', () => {
    expect(V2_EVERYWHERE.map((d) => d.label)).toEqual([
      'Needs you',
      'Live',
      'Incidents',
      'Map',
      'Runs',
      'Scheduled',
      'Settings',
    ]);
  });

  it('keeps Chats, Usage and Changelog as reachable destinations', () => {
    expect(V2_KEPT.map((d) => d.key)).toEqual(
      expect.arrayContaining(['global-chats', 'ws-usage', 'ws-changelog']),
    );
  });

  it('keeps the knowledge graph and explorer out of the More registry (VS-371)', () => {
    // They are reachable only as the Knowledge screen's Graph and Explorer tabs, so the desktop and
    // phone More lists must not offer them.
    expect(V2_KEPT.some((d) => d.key === 'ws-graph' || d.key === 'ws-explorer')).toBe(false);
    expect(V2_KEPT.some((d) => d.path.includes('/knowledge/'))).toBe(false);
  });
});
