import { describe, expect, it, vi } from 'vitest';
import {
  agentMarker, findPaneForAgent, findTabByLabel, findWorkspaceByLabel, paneCloseArgs, paneLabel, paneListArgs,
  paneRenameArgs, paneRunArgs, paneSplitArgs, parseCreatedPaneId, parsePaneList, parseTabList, parseWorkspaceList,
  tabCreateArgs, workspaceCreateArgs, workspaceListArgs,
} from '../src/commands.js';

const paneListJson = JSON.stringify({
  id: 'cli:pane:list',
  result: {
    type: 'pane_list',
    panes: [
      { pane_id: 'w6:p1', tab_id: 'w6:t1', workspace_id: 'w6', agent_status: 'working', terminal_title: 'conductor:conductor conductor' },
      { pane_id: 'w6:p2', tab_id: 'w6:t2', workspace_id: 'w6', agent_status: 'idle', terminal_title: 'conductor:w-1 ◑ ACME-42' },
      { pane_id: 'w9:p1', tab_id: 'w9:t1', workspace_id: 'w9', agent_status: 'unknown' },
    ],
  },
});

describe('herdr command building', () => {
  it('builds workspace and tab commands without stealing focus', () => {
    expect(workspaceListArgs()).toEqual(['workspace', 'list']);
    expect(workspaceCreateArgs('ac-acme', { env: { AC_TOKEN: 't' } }))
      .toEqual(['workspace', 'create', '--label', 'ac-acme', '--no-focus', '--env', 'AC_TOKEN=t']);
    expect(tabCreateArgs('w6', 'web')).toEqual(['tab', 'create', '--workspace', 'w6', '--label', 'web', '--no-focus']);
    expect(paneListArgs('w6')).toEqual(['pane', 'list', '--workspace', 'w6']);
  });

  it('splits right and runs the attach command as one quoted string', () => {
    expect(paneSplitArgs('w6:p1')).toEqual(['pane', 'split', 'w6:p1', '--direction', 'right', '--no-focus']);
    expect(paneRunArgs('w6:p2', ['conductor', 'attach', 'w-1', '--url', 'http://127.0.0.1:7433']))
      .toEqual(['pane', 'run', 'w6:p2', 'conductor attach w-1 --url http://127.0.0.1:7433']);
    expect(paneRenameArgs('w6:p2', paneLabel('w-1', '◑ ACME-42'))).toEqual(['pane', 'rename', 'w6:p2', 'conductor:w-1 ◑ ACME-42']);
    expect(paneCloseArgs('w6:p2')).toEqual(['pane', 'close', 'w6:p2']);
  });

  it('parses the socket API envelopes', () => {
    const panes = parsePaneList(paneListJson);
    expect(panes).toHaveLength(3);
    expect(panes[1]).toMatchObject({ paneId: 'w6:p2', tabId: 'w6:t2', workspaceId: 'w6', agentStatus: 'idle' });

    const workspaces = parseWorkspaceList(JSON.stringify({ result: { workspaces: [{ workspace_id: 'w6', label: 'ac-acme', active_tab_id: 'w6:t1', number: 8 }] } }));
    expect(findWorkspaceByLabel(workspaces, 'ac-acme')?.workspaceId).toBe('w6');
    expect(findWorkspaceByLabel(workspaces, 'nope')).toBeUndefined();

    const tabs = parseTabList(JSON.stringify({ result: { tabs: [{ tab_id: 'w6:t2', workspace_id: 'w6', label: 'web', number: 2 }] } }));
    expect(findTabByLabel(tabs, 'web')?.tabId).toBe('w6:t2');

    expect(parseCreatedPaneId(JSON.stringify({ result: { pane: { pane_id: 'w6:p3' } } }))).toBe('w6:p3');
    expect(parseCreatedPaneId('garbage')).toBeNull();
  });

  it('re-resolves panes by the agent marker rather than trusting stored ids', () => {
    const panes = parsePaneList(paneListJson);
    expect(agentMarker('w-1')).toBe('conductor:w-1');
    expect(findPaneForAgent(panes, 'w-1', 'w6')?.paneId).toBe('w6:p2');
    expect(findPaneForAgent(panes, 'conductor', 'w6')?.paneId).toBe('w6:p1');
    expect(findPaneForAgent(panes, 'w-9', 'w6')).toBeUndefined();
  });

  it('imports without touching the environment', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    vi.resetModules();
    const mod = (await import('../src/index.js')) as { default: { kind: string }; adapter: { kind: string } };
    expect(mod.adapter.kind).toBe('herdr');
    expect(mod.default).toBe(mod.adapter);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(timeoutSpy).not.toHaveBeenCalled();
    expect(intervalSpy).not.toHaveBeenCalled();
    timeoutSpy.mockRestore();
    intervalSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});
