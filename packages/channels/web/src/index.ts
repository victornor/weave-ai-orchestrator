import type {
  ChannelAdapter, ChannelCapabilities, ChannelContext, JsonSchema, OutboundMessage, RunningChannel, SendResult,
} from '@weave-ai/channel-sdk';

/**
 * The web channel is a no-op transport: the daemon delivers thread messages to the
 * browser over SSE (`GET /api/w/:ws/events`) and accepts inbound messages over REST
 * (`POST /api/w/:ws/threads/:id/messages`). The adapter exists so the web channel is
 * registered, capability-checked and config-validated like any other channel.
 */
export const capabilities: ChannelCapabilities = {
  supportsButtons: true,
  supportsMarkdown: true,
  supportsEdit: true,
  supportsThreads: true,
  supportsFiles: true,
  maxTextBytes: 1_000_000,
};

const SCHEMA: JsonSchema = { type: 'object', properties: {}, additionalProperties: false };

export function createWebChannel(): ChannelAdapter {
  return {
    kind: 'web',
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
      ctx.log('debug', 'web channel started (transport handled by the daemon)', { workspaceId: ctx.workspaceId });
      return { async stop() { /* nothing to tear down */ } };
    },
    async send(_msg: OutboundMessage): Promise<SendResult> {
      // Delivery happens when the browser reads the thread; treat as delivered.
      return { delivered: true };
    },
  };
}

export const adapter: ChannelAdapter = createWebChannel();
export default adapter;
