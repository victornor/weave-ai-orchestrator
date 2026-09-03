export type JsonSchema = Record<string, unknown>;
export interface ChannelCapabilities { supportsButtons: boolean; supportsMarkdown: boolean; supportsEdit: boolean; supportsThreads: boolean; supportsFiles: boolean; maxTextBytes: number }
export type CanonicalPart =
  | { type: 'text'; text: string }
  | { type: 'mention'; id: string; label: string }
  | { type: 'file'; name: string; mime: string; data?: Uint8Array; url?: string }
  | { type: 'card'; title: string; body: string; actions: Array<{ key: string; label: string; style?: 'primary' | 'danger' | 'default' }>; ref: { kind: 'decision'; id: string } }
  | { type: 'quote'; text: string };
export interface CanonicalMessage { parts: CanonicalPart[]; text: string }
export interface InboundMessage { externalThreadId: string; externalUserId: string; externalMessageId?: string; text: string; userLabel?: string; replyToExternalId?: string; action?: { decisionId: string; key: string } }
export interface OutboundMessage { threadExternalId: string; message: CanonicalMessage; replyToExternalId?: string }
export interface SendResult { externalMessageId?: string; delivered: boolean; error?: { code: string; retryable: boolean; message: string } }
export interface ChannelContext { workspaceId: string; config: Record<string, unknown>; inbound(msg: InboundMessage): Promise<void>; log(level: 'debug' | 'info' | 'warn' | 'error', msg: string, data?: Record<string, unknown>): void }
export interface RunningChannel { stop(): Promise<void> }
export interface ChannelAdapter {
  readonly kind: string; readonly capabilities: ChannelCapabilities;
  configSchema(): JsonSchema;
  validateConfig(config: unknown): { ok: true } | { ok: false; errors: string[] };
  start(ctx: ChannelContext): Promise<RunningChannel>;
  send(msg: OutboundMessage): Promise<SendResult>;
}
export class RetryableChannelError extends Error { constructor(msg: string, public code = 'retryable') { super(msg); } }
export class PermanentChannelError extends Error { constructor(msg: string, public code = 'permanent') { super(msg); } }

/** Degrade a message to the channel's capabilities: cards become numbered text with a reply syntax. */
export function degrade(msg: CanonicalMessage, caps: ChannelCapabilities): CanonicalMessage {
  if (caps.supportsButtons) return msg;
  const parts: CanonicalPart[] = [];
  for (const p of msg.parts) {
    if (p.type === 'card') {
      const lines = [`**${p.title}**`, p.body, '', ...p.actions.map((a, i) => `${i + 1}. ${a.label}`), '', `Reply: /d ${p.ref.id} <number or text>`];
      parts.push({ type: 'text', text: lines.join('\n') });
    } else parts.push(p);
  }
  return { parts, text: parts.map((p) => (p.type === 'text' ? p.text : p.type === 'quote' ? `> ${p.text}` : p.type === 'mention' ? `@${p.label}` : `[${p.type}]`)).join('\n') };
}
export function textMessage(text: string): CanonicalMessage { return { parts: [{ type: 'text', text }], text }; }
