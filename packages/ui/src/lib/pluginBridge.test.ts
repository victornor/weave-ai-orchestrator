import { describe, expect, it } from 'vitest';
import { isPluginBridgeMessage, resolveBridgePath } from './pluginBridge';

describe('resolveBridgePath (VS-334)', () => {
  it('resolves a plain path under the plugin prefix', () => {
    expect(resolveBridgePath('acme', 'notes', '/notes')).toBe('/api/w/acme/plugins/notes/notes');
  });
  it('resolves a nested path with a query string', () => {
    expect(resolveBridgePath('acme', 'notes', '/notes/abc?x=1')).toBe('/api/w/acme/plugins/notes/notes/abc?x=1');
  });
  it('rejects a path that escapes the prefix with ..', () => {
    expect(resolveBridgePath('acme', 'notes', '../otherplugin/x')).toBeNull();
    expect(resolveBridgePath('acme', 'notes', '/../plugin-data/notes')).toBeNull();
  });
  it('rejects an absolute URL', () => {
    expect(resolveBridgePath('acme', 'notes', 'http://evil.example/x')).toBeNull();
    expect(resolveBridgePath('acme', 'notes', '//evil.example/x')).toBeNull();
  });
  it('rejects a path naming a sibling top-level route outside any plugin prefix', () => {
    expect(resolveBridgePath('acme', 'notes', '/../../plugin-data/notes')).toBeNull();
  });
  it('rejects a path naming another plugin explicitly', () => {
    expect(resolveBridgePath('acme', 'notes', '/../other/secret')).toBeNull();
  });
  it('rejects an empty or non-string path', () => {
    expect(resolveBridgePath('acme', 'notes', '')).toBeNull();
  });
});

describe('isPluginBridgeMessage (VS-334)', () => {
  it('accepts a well-formed request message', () => {
    expect(isPluginBridgeMessage({ type: 'request', id: '1', method: 'GET', path: '/notes' })).toBe(true);
  });
  it('accepts a well-formed subscribe message', () => {
    expect(isPluginBridgeMessage({ type: 'subscribe', kind: 'note.created' })).toBe(true);
  });
  it('rejects garbage', () => {
    expect(isPluginBridgeMessage(null)).toBe(false);
    expect(isPluginBridgeMessage('hello')).toBe(false);
    expect(isPluginBridgeMessage({ type: 'request', id: 1, method: 'GET', path: '/x' })).toBe(false);
    expect(isPluginBridgeMessage({ type: 'other' })).toBe(false);
  });
});
