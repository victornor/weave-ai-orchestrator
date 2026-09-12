import { describe, expect, it, vi } from 'vitest';
import {
  classPattern, clientsArgs, closeArgs, execArgs, findClient, focusArgs, formatClassFlag, parseClients,
  windowClass, windowRuleArgs, workspaceClassPattern,
} from '../src/commands.js';

const foot = { cmd: 'foot', classFlag: '-a', execFlag: '-e' };
const ghostty = { cmd: 'ghostty', classFlag: '--class=', execFlag: '-e' };

describe('hyprctl command building', () => {
  it('derives a per-agent window class', () => {
    expect(windowClass('acme', 'w-1')).toBe('ac-acme-w-1');
    expect(windowClass('acme corp', 'w/2')).toBe('ac-acme-corp-w-2');
    expect(classPattern('ac-acme-w-1')).toBe('^(ac-acme-w-1)$');
    expect(workspaceClassPattern('acme')).toBe('^(ac-acme-.*)$');
  });

  it('builds both spellings of the workspace rule', () => {
    expect(windowRuleArgs('windowrule', 'acme', 5)).toEqual(['keyword', 'windowrule', 'workspace 5 silent, class:^(ac-acme-.*)$']);
    expect(windowRuleArgs('windowrulev2', 'acme', '5')[1]).toBe('windowrulev2');
  });

  it('formats class flags for attached and detached spellings', () => {
    expect(formatClassFlag('-a', 'ac-x')).toBe('-a ac-x');
    expect(formatClassFlag('--class=', 'ac-x')).toBe('--class=ac-x');
  });

  it('spawns the terminal on the configured workspace', () => {
    const args = execArgs({ terminal: foot, cls: 'ac-acme-w-1', command: ['weave', 'attach', 'w-1'], hyprWorkspace: 5 });
    expect(args).toEqual(['dispatch', 'exec', '[workspace 5 silent] foot -a ac-acme-w-1 -e weave attach w-1']);
  });

  it('omits the workspace rule when none is configured (weaver terminal)', () => {
    const args = execArgs({ terminal: ghostty, cls: 'ac-acme-weaver', command: ['weave', 'chat'], hyprWorkspace: null });
    expect(args[2]).toBe('ghostty --class=ac-acme-weaver -e weave chat');
  });

  it('quotes command arguments that need it', () => {
    const args = execArgs({ terminal: foot, cls: 'c', command: ['weave', 'say', 'hello world'], hyprWorkspace: 1 });
    expect(args[2]).toContain("'hello world'");
  });

  it('targets windows by class for focus and close', () => {
    expect(focusArgs('ac-acme-w-1')).toEqual(['dispatch', 'focuswindow', 'class:^(ac-acme-w-1)$']);
    expect(closeArgs('ac-acme-w-1')).toEqual(['dispatch', 'closewindow', 'class:^(ac-acme-w-1)$']);
    expect(clientsArgs()).toEqual(['clients', '-j']);
  });

  it('parses hyprctl clients -j and matches by class or initialClass', () => {
    const json = JSON.stringify([
      { address: '0x1', class: 'ac-acme-w-1', title: 'frontend · ACME-42 · working', workspace: { id: 5 } },
      { address: '0x2', class: 'foot', initialClass: 'ac-acme-w-2' },
      { nonsense: true },
    ]);
    const clients = parseClients(json);
    expect(clients).toHaveLength(2);
    expect(findClient(clients, 'ac-acme-w-1')?.address).toBe('0x1');
    expect(findClient(clients, 'ac-acme-w-2')?.address).toBe('0x2');
    expect(findClient(clients, 'ac-acme-w-3')).toBeUndefined();
    expect(parseClients('not json')).toEqual([]);
  });

  it('imports without touching the environment', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    vi.resetModules();
    const mod = (await import('../src/index.js')) as { default: { kind: string }; adapter: { kind: string } };
    expect(mod.adapter.kind).toBe('hyprland');
    expect(mod.default).toBe(mod.adapter);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(timeoutSpy).not.toHaveBeenCalled();
    expect(intervalSpy).not.toHaveBeenCalled();
    timeoutSpy.mockRestore();
    intervalSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});
