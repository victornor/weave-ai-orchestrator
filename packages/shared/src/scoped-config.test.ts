import { describe, expect, it } from 'vitest';
import { DaemonConfigSchema, WorkspaceConfigSchema } from './config.js';
import { disabledInherited, mergeScoped, mergedValues } from './scoped-config.js';

describe('mergeScoped', () => {
  const daemon = { a: { n: 1 }, b: { n: 2 } };
  it('shows the daemon set to a workspace with none', () => {
    expect(mergeScoped({ daemon, workspace: {} })).toEqual({ a: { value: { n: 1 }, source: 'daemon' }, b: { value: { n: 2 }, source: 'daemon' } });
  });
  it('replaces a daemon entry whole, without a field merge, and adds workspace-only ones', () => {
    const got = mergeScoped<{ n: number; extra?: boolean }>({ daemon: { a: { n: 1, extra: true } }, workspace: { a: { n: 9 }, c: { n: 3 } } });
    expect(got['a']).toEqual({ value: { n: 9 }, source: 'override' });
    expect(got['c']).toEqual({ value: { n: 3 }, source: 'workspace' });
  });
  it('hides a disabled inherited entry, but a workspace entry of that name wins', () => {
    expect(Object.keys(mergedValues({ daemon, workspace: {}, disabled: ['a'] }))).toEqual(['b']);
    expect(mergedValues({ daemon, workspace: { a: { n: 7 } }, disabled: ['a'] })['a']).toEqual({ n: 7 });
    expect(disabledInherited({ daemon, workspace: {}, disabled: ['a', 'zzz'] })).toEqual(['a']);
  });
  it('removing the override restores the daemon entry', () => {
    expect(mergedValues({ daemon, workspace: { a: { n: 9 } } })['a']).toEqual({ n: 9 });
    expect(mergedValues({ daemon, workspace: {} })['a']).toEqual({ n: 1 });
  });
  it('a workspace-only entry loads with no daemon set (regression)', () => {
    expect(mergedValues({ daemon: undefined, workspace: { w: { n: 1 } } })).toEqual({ w: { n: 1 } });
  });
});

describe('scoped config schemas', () => {
  it('accepts providers and MCP servers in daemon.yaml, defaulting to none', () => {
    expect(DaemonConfigSchema.parse({}).providers).toEqual({});
    const d = DaemonConfigSchema.parse({ providers: { openai: { baseUrl: 'https://api.example.com/v1' } }, mcpServers: { docs: { type: 'http', url: 'https://mcp.example.com' } } });
    expect(Object.keys(d.providers)).toEqual(['openai']);
    expect(Object.keys(d.mcpServers)).toEqual(['docs']);
  });
  it('rejects the reserved MCP name at the daemon level too', () => {
    expect(DaemonConfigSchema.safeParse({ mcpServers: { 'weave-ai': { type: 'http', url: 'https://x.example.com' } } }).success).toBe(false);
  });
  it('workspace disable lists default empty', () => {
    const w = WorkspaceConfigSchema.parse({ version: 1, id: 'w', name: 'W', ticketPrefix: 'WW' });
    expect(w.disabledProviders).toEqual([]);
    expect(w.disabledMcpServers).toEqual([]);
  });
});
