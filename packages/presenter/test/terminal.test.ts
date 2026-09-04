import { describe, expect, it } from 'vitest';
import { DEFAULT_TERMINAL_FLAGS, TERMINAL_FLAGS, resolveTerminal, terminalSpecFor } from '../src/terminal.js';

describe('terminal resolution', () => {
  it('knows the flag spelling of each emulator', () => {
    expect(terminalSpecFor('foot')).toEqual({ cmd: 'foot', classFlag: '-a', execFlag: '-e' });
    expect(terminalSpecFor('kitty').classFlag).toBe('--class');
    expect(terminalSpecFor('ghostty').classFlag).toBe('--class=');
    expect(terminalSpecFor('alacritty').execFlag).toBe('-e');
    expect(terminalSpecFor('wezterm').execFlag).toBe('start --');
    expect(terminalSpecFor('xterm').classFlag).toBe('-class');
    expect(TERMINAL_FLAGS['xdg-terminal-exec']).toEqual({ classFlag: '--app-id=', execFlag: '--' });
  });

  it('looks flags up by binary name even with a path or extra args', () => {
    expect(terminalSpecFor('/usr/bin/foot')).toMatchObject({ cmd: '/usr/bin/foot', classFlag: '-a' });
    expect(terminalSpecFor('kitty --single-instance')).toMatchObject({ cmd: 'kitty --single-instance', classFlag: '--class' });
  });

  it('falls back to generic flags for unknown emulators', () => {
    expect(terminalSpecFor('someterm')).toMatchObject(DEFAULT_TERMINAL_FLAGS);
  });

  it('prefers the configured terminal, then $TERMINAL, then xdg-terminal-exec', () => {
    const env = { TERMINAL: 'kitty' };
    expect(resolveTerminal({ configured: 'foot', env, exists: () => false })?.cmd).toBe('foot');
    expect(resolveTerminal({ env, exists: () => false })?.cmd).toBe('kitty');
    expect(resolveTerminal({ env: {}, exists: (c) => c === 'xdg-terminal-exec' })?.cmd).toBe('xdg-terminal-exec');
  });

  it('returns null when nothing can be resolved, so the surface can say so', () => {
    expect(resolveTerminal({ env: {}, exists: () => false })).toBeNull();
    expect(resolveTerminal({ configured: '   ', env: {}, exists: () => false })).toBeNull();
  });
});
