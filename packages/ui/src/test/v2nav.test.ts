/** The V2 destination registry: the scope rule and the single-highlight rule, as pure functions. */
import { describe, expect, it } from 'vitest';
import {
  V2_EVERYWHERE,
  V2_KEPT,
  V2_RAIL_EVERYWHERE,
  V2_RAIL_WORKSPACE,
  V2_WORKSPACE,
  activeNavKey,
  projectRowKey,
  v2Href,
  workspaceFromV2Path,
} from '../v2/nav';

describe('scope from a V2 path', () => {
  it('reads the workspace out of a workspace path', () => {
    expect(workspaceFromV2Path('/w/acme/work')).toBe('acme');
    expect(workspaceFromV2Path('/w/acme')).toBe('acme');
    expect(workspaceFromV2Path('/w/acme/tickets/ACME-1')).toBe('acme');
  });

  it('is Everywhere for a path that names no workspace', () => {
    expect(workspaceFromV2Path('/needs')).toBeNull();
    expect(workspaceFromV2Path('/')).toBeNull();
    expect(workspaceFromV2Path('/chats')).toBeNull();
  });
});

describe('the single highlighted row', () => {
  it('highlights the global row on a global path', () => {
    expect(activeNavKey('/needs')).toBe('global-needs');
    expect(activeNavKey('/live')).toBe('global-live');
    expect(activeNavKey('/chats')).toBe('global-chats');
    expect(activeNavKey('/runs')).toBe('global-runs');
    expect(activeNavKey('/runs/01ABC')).toBe('global-runs');
  });

  it('highlights the workspace row on a workspace path', () => {
    expect(activeNavKey('/w/acme/chat')).toBe('ws-chat');
    expect(activeNavKey('/w/acme/needs')).toBe('ws-needs');
    expect(activeNavKey('/w/acme/work')).toBe('ws-work');
    expect(activeNavKey('/w/acme/roles')).toBe('ws-roles');
    expect(activeNavKey('/w/acme/knowledge')).toBe('ws-knowledge');
  });

  it('maps a drill-down to the destination that owns it', () => {
    expect(activeNavKey('/w/acme/tickets/ACME-1')).toBe('ws-work');
    expect(activeNavKey('/w/acme/workers/w1')).toBe('ws-roles');
    expect(activeNavKey('/w/acme/artifacts/a1')).toBe('ws-knowledge');
    expect(activeNavKey('/w/acme/p/web')).toBe(projectRowKey('web'));
  });

  it('is null where nothing owns the path', () => {
    expect(activeNavKey('/')).toBeNull();
    expect(activeNavKey('/w/acme/nonsense')).not.toBeNull();
  });
});

describe('addresses preserve scope', () => {
  const work = V2_WORKSPACE.find((d) => d.key === 'ws-work')!;
  const needs = V2_EVERYWHERE.find((d) => d.key === 'global-needs')!;

  it('fills $ws from the current workspace scope', () => {
    expect(v2Href(work, { kind: 'workspace', ws: 'acme' })).toBe('/w/acme/work');
  });

  it('fills $ws from the fallback when the scope is Everywhere', () => {
    expect(v2Href(work, { kind: 'everywhere' }, 'acme')).toBe('/w/acme/work');
  });

  it('leaves a global address alone', () => {
    expect(v2Href(needs, { kind: 'workspace', ws: 'acme' }, 'acme')).toBe('/needs');
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

  it('carries Chats in the rail Everywhere group, after Live', () => {
    expect(V2_RAIL_EVERYWHERE.map((d) => d.key)).toEqual([
      'global-needs',
      'global-live',
      'global-chats',
      'global-incidents',
      'global-map',
      'global-runs',
      'global-scheduled',
      'global-settings',
    ]);
  });

  it('carries Usage and Changelog in each workspace rail group', () => {
    expect(V2_RAIL_WORKSPACE.map((d) => d.key)).toEqual([
      'ws-chat',
      'ws-needs',
      'ws-work',
      'ws-roles',
      'ws-knowledge',
      'ws-usage',
      'ws-changelog',
    ]);
    // The knowledge sub-pages stay out of the rail; they are the Knowledge screen's own tabs (VS-371).
    expect(V2_RAIL_WORKSPACE.map((d) => d.key)).not.toContain('ws-graph');
    expect(V2_RAIL_WORKSPACE.map((d) => d.key)).not.toContain('ws-explorer');
  });
});
