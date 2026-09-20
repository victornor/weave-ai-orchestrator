import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelAdapter } from '../src/index.js';

/**
 * Contract: a channel module may only construct at import — no network, no timers.
 * Every built-in channel is imported here with fetch and the timer functions mocked.
 */
const CHANNELS = [
  { kind: 'web', path: '../../channels/web/src/index.js' },
  { kind: 'cli', path: '../../channels/cli/src/index.js' },
  { kind: 'telegram', path: '../../channels/telegram/src/index.js' },
] as const;

describe('channel import contract', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  for (const channel of CHANNELS) {
    it(`${channel.kind} performs no IO at import`, async () => {
      const fetchSpy = vi.fn(async () => new Response('{}'));
      vi.stubGlobal('fetch', fetchSpy);
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

      const mod = (await import(channel.path)) as { default: ChannelAdapter; adapter: ChannelAdapter };

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(setTimeoutSpy).not.toHaveBeenCalled();
      expect(setIntervalSpy).not.toHaveBeenCalled();

      expect(mod.default).toBe(mod.adapter);
      expect(mod.adapter.kind).toBe(channel.kind);
      vi.unstubAllGlobals();
    });

    it(`${channel.kind} exposes capabilities, a schema and validation`, async () => {
      const mod = (await import(channel.path)) as { adapter: ChannelAdapter };
      const adapter = mod.adapter;
      expect(typeof adapter.capabilities.supportsButtons).toBe('boolean');
      expect(adapter.capabilities.maxTextBytes).toBeGreaterThan(0);
      expect(adapter.configSchema()).toMatchObject({ type: 'object' });
      expect(typeof adapter.validateConfig({}).ok).toBe('boolean');
    });
  }

  it('web and cli deliver without a transport of their own', async () => {
    for (const path of ['../../channels/web/src/index.js', '../../channels/cli/src/index.js']) {
      const { adapter } = (await import(path)) as { adapter: ChannelAdapter };
      expect(adapter.capabilities.supportsButtons).toBe(true);
      const logs: string[] = [];
      const running = await adapter.start({
        workspaceId: 'acme',
        config: {},
        async inbound() { /* server-side */ },
        log: (_l, msg) => logs.push(msg),
      });
      expect(await adapter.send({ threadExternalId: 't1', message: { text: 'hi', parts: [{ type: 'text', text: 'hi' }] } }))
        .toEqual({ delivered: true });
      await running.stop();
    }
  });
});

/** VS-604: progress is optional, so a channel that cannot show it is still a complete adapter. */
describe('channel progress contract', () => {
  const minimal: ChannelAdapter = {
    kind: 'minimal',
    capabilities: { supportsButtons: false, supportsMarkdown: false, supportsEdit: false, supportsThreads: false, supportsFiles: false, maxTextBytes: 1024 },
    configSchema: () => ({ type: 'object' }),
    validateConfig: () => ({ ok: true }),
    async start() { return { stop: async () => undefined }; },
    async send() { return { delivered: true }; },
  };

  it('an adapter without progress is a valid adapter the daemon can use', async () => {
    expect(minimal.progress).toBeUndefined();
    const running = await minimal.start({ workspaceId: 'acme', config: {}, async inbound() { /* noop */ }, log() { /* noop */ } });
    expect(await minimal.send({ threadExternalId: 't1', message: { text: 'hi', parts: [{ type: 'text', text: 'hi' }] } })).toEqual({ delivered: true });
    await minimal.progress?.({ threadExternalId: 't1', phase: 'start' });
    await running.stop();
  });

  it('the web and cli channels implement no progress', async () => {
    for (const path of ['../../channels/web/src/index.js', '../../channels/cli/src/index.js']) {
      const { adapter } = (await import(path)) as { adapter: ChannelAdapter };
      expect(adapter.progress).toBeUndefined();
    }
  });
});
