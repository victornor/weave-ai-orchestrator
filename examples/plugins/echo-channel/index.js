/**
 * A minimal third-party AgentConductor plugin (PLAN §17).
 *
 * It registers two things:
 *   - a channel adapter `echo` that logs every outbound message and never produces inbound ones,
 *     which makes it a useful sink for watching what the conductor would say;
 *   - a hook on `ticket.status` that logs each ticket status change.
 *
 * Plain JavaScript on purpose: a plugin needs no build step and no TypeScript to be loadable.
 * See ../README.md for how to list it under `plugins:` in workspace.yaml.
 */
import { definePlugin } from '@agent-conductor/plugin-sdk';

/** ChannelAdapter (packages/channel-sdk). Outbound only: `start()` never calls `ctx.inbound`. */
function echoChannel(logger, options) {
  const prefix = typeof options.prefix === 'string' ? options.prefix : 'echo';
  return {
    kind: 'echo',
    capabilities: {
      supportsButtons: false,
      supportsMarkdown: true,
      supportsEdit: false,
      supportsThreads: true,
      supportsFiles: false,
      maxTextBytes: 16_000,
    },
    configSchema: () => ({
      type: 'object',
      properties: { prefix: { type: 'string', description: 'prefix written in front of every echoed line' } },
      additionalProperties: false,
    }),
    validateConfig: (config) =>
      config === null || typeof config !== 'object' || typeof (config.prefix ?? '') === 'string'
        ? { ok: true }
        : { ok: false, errors: ['prefix must be a string'] },
    start: async () => {
      logger.info('echo channel started');
      return { stop: async () => { logger.info('echo channel stopped'); } };
    },
    send: async (msg) => {
      logger.info(`${prefix}: ${msg.message.text}`, { thread: msg.threadExternalId });
      return { delivered: true, externalMessageId: `${prefix}-${Date.now()}` };
    },
  };
}

export default definePlugin({
  id: 'example-echo-channel',
  version: '0.1.0',
  apiVersion: 1,
  register(host) {
    const options = host.config() ?? {};
    host.registerChannel(echoChannel(host.logger, options));
    host.registerHook({
      events: ['ticket.status'],
      handler: async (ev) => {
        const status = ev.payload && typeof ev.payload === 'object' ? ev.payload.status : undefined;
        host.logger.info(`ticket ${ev.entityId} is now ${String(status ?? 'unknown')}`, { seq: ev.seq, type: ev.type });
      },
    });
    host.logger.info('echo plugin registered');
  },
});
