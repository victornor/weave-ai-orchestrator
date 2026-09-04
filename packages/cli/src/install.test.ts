import { describe, expect, it } from 'vitest';
import { planInstall } from './install.js';

const host = (platform: NodeJS.Platform, bins: string[]) => ({ platform, has: (b: string) => bins.includes(b) });

describe('planInstall', () => {
  it('installs npm-distributed tools with the global npm', () => {
    expect(planInstall('openspec', host('linux', ['npm'])).command).toEqual(['npm', 'install', '-g', '@fission-ai/openspec']);
    expect(planInstall('claude', host('linux', ['pnpm'])).command).toEqual(['pnpm', 'add', '-g', '@anthropic-ai/claude-code']);
    expect(planInstall('opencode', host('linux', [])).command).toBeNull();
  });
  it('never plans a sudo command; root-needing installs are printed', () => {
    const wt = planInstall('wt', host('linux', ['pacman']));
    expect(wt.command).toBeNull();
    expect(wt.manual).toBe('sudo pacman -S worktrunk');
    const gh = planInstall('gh', host('linux', ['apt-get']));
    expect(gh.command).toBeNull();
    expect(gh.manual).toContain('apt-get');
  });
  it('prefers brew on macOS and cargo elsewhere for worktrunk', () => {
    expect(planInstall('wt', host('darwin', ['brew', 'cargo'])).command).toEqual(['brew', 'install', 'worktrunk']);
    expect(planInstall('wt', host('linux', ['cargo'])).command).toEqual(['cargo', 'install', 'worktrunk']);
    expect(planInstall('wt', host('linux', ['cargo', 'cargo-binstall'])).command?.[1]).toBe('binstall');
  });
});
