import { describe, expect, it, vi } from 'vitest';
import type { AgentView } from '@openconductor/surface-sdk';
import {
  findWindow, hasSessionArgs, killWindowArgs, listWindowsArgs, newSessionArgs, newWindowArgs, parseListWindows,
  renameWindowArgs, sessionName, shellQuote, statusGlyph, windowName,
} from '../src/commands.js';

const agent: AgentView = {
  agentId: 'w-1', workspaceId: 'acme', name: 'Frontend Engineer #4', kind: 'worker',
  projectId: 'web', ticketIdentifier: 'ACME-42', roleName: 'frontend', status: 'running', uiStatus: 'working',
};

describe('tmux command building', () => {
  it('names the session after the workspace', () => {
    expect(sessionName('acme')).toBe('oc-acme');
    expect(sessionName('acme.corp prod')).toBe('oc-acme-corp-prod');
  });

  it('builds a window name from the ticket and a status glyph', () => {
    expect(windowName(agent, 'working')).toBe(`${statusGlyph('working')} ACME-42`);
    expect(windowName({ ...agent, ticketIdentifier: null }, 'blocked')).toBe(`${statusGlyph('blocked')} frontend`);
    expect(statusGlyph('nonsense')).toBe('·');
  });

  it('quotes the attach command for the shell', () => {
    expect(shellQuote(['oc', 'attach', 'w-1', '--url', 'http://127.0.0.1:7433'])).toBe('oc attach w-1 --url http://127.0.0.1:7433');
    expect(shellQuote(['oc', 'say', "it's fine"])).toBe("oc say 'it'\\''s fine'");
  });

  it('creates the session with the conductor in window 0', () => {
    const args = newSessionArgs('oc-acme', 'conductor', ['oc', 'chat'], { OC_TOKEN: 't' });
    expect(args.slice(0, 6)).toEqual(['new-session', '-d', '-s', 'oc-acme', '-n', 'conductor']);
    expect(args).toContain('-e');
    expect(args).toContain('OC_TOKEN=t');
    expect(args.at(-1)).toBe('oc chat');
  });

  it('creates a worker window that prints its id', () => {
    const args = newWindowArgs('oc-acme', 'x ACME-42', ['oc', 'attach', 'w-1']);
    expect(args).toEqual(['new-window', '-d', '-t', 'oc-acme:', '-n', 'x ACME-42', '-P', '-F', '#{window_id}', 'oc attach w-1']);
  });

  it('targets sessions and windows exactly', () => {
    expect(hasSessionArgs('oc-acme')).toEqual(['has-session', '-t', '=oc-acme']);
    expect(listWindowsArgs('oc-acme')).toEqual(['list-windows', '-t', '=oc-acme', '-F', '#{window_id}\t#{window_name}\t#{@oc_agent}']);
    expect(renameWindowArgs('@3', 'y ACME-42')).toEqual(['rename-window', '-t', '@3', 'y ACME-42']);
    expect(killWindowArgs('@3')).toEqual(['kill-window', '-t', '@3']);
  });

  it('parses list-windows output and finds the agent window', () => {
    const windows = parseListWindows('@0\tconductor\tconductor\n@3\tw ACME-42\tw-1\nnot-a-window\n');
    expect(windows).toEqual([
      { windowId: '@0', name: 'conductor', agentId: 'conductor' },
      { windowId: '@3', name: 'w ACME-42', agentId: 'w-1' },
    ]);
    expect(findWindow(windows, 'w-1')?.windowId).toBe('@3');
    expect(findWindow(windows, 'missing', '@0')?.windowId).toBe('@0');
    expect(findWindow(windows, 'missing')).toBeUndefined();
  });

  it('imports without touching the environment', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    vi.resetModules();
    const mod = (await import('../src/index.js')) as { default: { kind: string }; adapter: { kind: string } };
    expect(mod.adapter.kind).toBe('tmux');
    expect(mod.default).toBe(mod.adapter);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(timeoutSpy).not.toHaveBeenCalled();
    expect(intervalSpy).not.toHaveBeenCalled();
    timeoutSpy.mockRestore();
    intervalSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});
