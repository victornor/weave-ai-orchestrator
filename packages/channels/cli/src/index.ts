import type {
  ChannelAdapter, ChannelCapabilities, ChannelContext, JsonSchema, OutboundMessage, RunningChannel, SendResult,
} from '@weave-ai/channel-sdk';

/**
 * The cli channel is a no-op transport: `weave chat` / `weave attach` read and write threads
 * over the HTTP API. The adapter exists so the channel can be registered, capability-
 * checked and config-validated like any other channel.
 */
export const capabilities: ChannelCapabilities = {
  supportsButtons: true,
  supportsMarkdown: true,
  supportsEdit: false,
  supportsThreads: true,
  supportsFiles: false,
  maxTextBytes: 1_000_000,
};

const SCHEMA: JsonSchema = { type: 'object', properties: {}, additionalProperties: false };

export function createCliChannel(): ChannelAdapter {
  return {
    kind: 'cli',
    capabilities,
    configSchema(): JsonSchema {
      return SCHEMA;
    },
    validateConfig(config: unknown) {
      if (config === undefined || config === null) return { ok: true } as const;
      if (typeof config !== 'object' || Array.isArray(config)) return { ok: false, errors: ['config must be an object'] } as const;
      const extra = Object.keys(config as Record<string, unknown>);
      if (extra.length) return { ok: false, errors: [`unknown config keys: ${extra.join(', ')}`] } as const;
      return { ok: true } as const;
    },
    async start(ctx: ChannelContext): Promise<RunningChannel> {
      ctx.log('debug', 'cli channel started (transport handled by the conductor client)', { workspaceId: ctx.workspaceId });
      return { async stop() { /* nothing to tear down */ } };
    },
    async send(_msg: OutboundMessage): Promise<SendResult> {
      // The TUI pulls thread messages over HTTP; nothing to push.
      return { delivered: true };
    },
  };
}

export const adapter: ChannelAdapter = createCliChannel();
export default adapter;
