/**
 * Per-workspace channel manager (PLAN §14). Starts the configured adapters, routes inbound
 * messages into `threads`, and drains outbound `thread_messages` rows with `delivery_status =
 * 'pending'` through the owning adapter with capability degradation and backoff.
 */
import type { ChannelAdapter, CanonicalMessage, CanonicalPart, InboundMessage, RunningChannel } from '@agent-conductor/channel-sdk';
import { degrade, textMessage } from '@agent-conductor/channel-sdk';
import type { Actor, CoreServices, SecretsService, WorkspaceContext } from '@agent-conductor/core';
import { getLogger } from '@agent-conductor/core';
import { newId, nowIso } from '@agent-conductor/db';
import { UNRESOLVED_ENV_REF } from '@agent-conductor/channel-telegram';
import { TELEGRAM_BOT_TOKEN_SECRET_NAME, type Decision, type WorkspaceEvent } from '@agent-conductor/shared';

const log = getLogger('channel');
const SYSTEM: Actor = { kind: 'system', id: null };
const MAX_ATTEMPTS = 5;
const SWEEP_MS = 10_000;

/** The Telegram bot token, and which of the two possible sources it came from — the secret store wins over a resolved `${ENV_VAR}` in workspace.yaml. Never returns an unresolved `${...}` reference as a token. */
export type TelegramTokenResolution = { token: string; source: 'secret' } | { token: string; source: 'env' } | { token: null; source: null };

export function resolveTelegramToken(ctx: WorkspaceContext, secrets: SecretsService): TelegramTokenResolution {
  const fromStore = secrets.value(TELEGRAM_BOT_TOKEN_SECRET_NAME);
  if (fromStore) return { token: fromStore, source: 'secret' };
  const configured = (ctx.config.channels['telegram'] as { botToken?: string } | undefined)?.botToken;
  if (configured && !UNRESOLVED_ENV_REF.test(configured)) return { token: configured, source: 'env' };
  return { token: null, source: null };
}

export const HELP_TEXT = [
  'Commands',
  '/talk <ticket>   talk to the worker on a ticket (e.g. /talk ACME-42)',
  '/conductor       switch this thread back to the conductor',
  '/d <id> <answer> answer a decision by option number, key or free text',
  '/help            this list',
  '',
  'Anything else goes to whoever this thread is bound to.',
].join('\n');

interface PendingRow {
  id: string; threadId: string; body: string; parts: unknown; attempts: number;
  externalThreadId: string | null; channelKind: string;
}

export class ChannelManager {
  private running = new Map<string, RunningChannel>();
  private adapters = new Map<string, ChannelAdapter>();
  private unsubscribe: (() => void) | null = null;
  private sweep: NodeJS.Timeout | null = null;
  private draining = false;
  private stopped = false;
  private cardsSent = new Set<string>();

  constructor(private ctx: WorkspaceContext, private services: CoreServices) {}

  /** Every channel named under `channels:` or in `conductor.channels`. */
  configuredKinds(): string[] {
    return [...new Set([...Object.keys(this.ctx.config.channels), ...this.ctx.config.conductor.channels])];
  }

  async start(): Promise<void> {
    for (const kind of this.configuredKinds()) {
      await this.startOne(kind);
    }
    this.unsubscribe = this.ctx.events.on((ev) => { void this.onEvent(ev); });
    this.sweep = setInterval(() => { void this.drain(); }, SWEEP_MS);
    this.sweep.unref?.();
    await this.drain();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.unsubscribe?.();
    if (this.sweep) clearInterval(this.sweep);
    for (const [kind, handle] of this.running) {
      await handle.stop().catch((e: unknown) => log.warn({ err: e, kind }, 'channel stop failed'));
    }
    this.running.clear();
  }

  /**
   * The config to start `kind` with — for `telegram`, the workspace-yaml config with the token
   * replaced by whichever source `resolveTelegramToken` picks (VS-125); every other kind is
   * unchanged. `null` means "do not start": a configured-but-tokenless Telegram channel is off, not
   * an error (criterion 7 — "off because it has no token").
   */
  private effectiveConfig(kind: string): Record<string, unknown> | null {
    const base = this.ctx.config.channels[kind] ?? {};
    if (kind !== 'telegram') return base;
    const resolved = resolveTelegramToken(this.ctx, this.services.secrets);
    if (!resolved.token) return null;
    return { ...base, botToken: resolved.token };
  }

  /** Starts one channel kind, stopping and clearing any bookkeeping for it first is the caller's job (see `restartChannel`). */
  private async startOne(kind: string): Promise<void> {
    const adapter = this.ctx.registries.channels.get(kind);
    if (!adapter) { log.warn({ kind, workspace: this.ctx.workspaceId }, 'channel is configured but no adapter is registered'); return; }
    const config = this.effectiveConfig(kind);
    if (!config) { log.info({ kind }, 'channel has no resolvable token; not starting'); return; }
    const valid = adapter.validateConfig(config);
    if (!valid.ok) { log.error({ kind, errors: valid.errors }, 'channel config rejected by the adapter'); return; }
    try {
      this.ensureChannelRow(kind, config);
      const handle = await adapter.start({
        workspaceId: this.ctx.workspaceId,
        config,
        inbound: (msg) => this.onInbound(kind, msg),
        log: (level, msg, data) => log[level]({ kind, ...data }, msg),
      });
      this.adapters.set(kind, adapter);
      this.running.set(kind, handle);
      log.info({ kind }, 'channel started');
    } catch (e) {
      log.error({ err: e, kind }, 'channel failed to start');
    }
  }

  /** Stops `kind` if running, then starts it again with the current effective config — the live-reload primitive VS-125 needs for the token and, in principle, any future channel-config change. Never restarts the daemon. */
  async restartChannel(kind: string): Promise<void> {
    const running = this.running.get(kind);
    if (running) {
      this.running.delete(kind);
      this.adapters.delete(kind);
      await running.stop().catch((e: unknown) => log.warn({ err: e, kind }, 'channel stop failed during restart'));
    }
    await this.startOne(kind);
  }

  // ---------- inbound ----------

  private async onInbound(kind: string, msg: InboundMessage): Promise<void> {
    try {
      const thread = this.services.threads.bindOrGet(kind, msg.externalThreadId, msg.externalUserId, msg.userLabel);
      const actor: Actor = { kind: 'human', id: msg.externalUserId ?? null };

      if (msg.action) {
        await this.services.decisions.answer(actor, msg.action.decisionId, { key: msg.action.key });
        await this.reply(thread.id, `Recorded: ${msg.action.key}`);
        return;
      }

      const text = (msg.text ?? '').trim();
      if (await this.handleCommand(actor, thread.id, text)) return;
      await this.services.threads.inbound(actor, thread.id, text, { externalMessageId: msg.externalMessageId });
    } catch (e) {
      log.error({ err: e, kind }, 'inbound message failed');
    }
  }

  /** `/talk <ticket>` · `/conductor` · `/d <decisionId> <key|text>` · `/help` (PLAN §14.2). Kind-agnostic: every channel gets the same commands. */
  private async handleCommand(actor: Actor, threadId: string, text: string): Promise<boolean> {
    if (/^\/help\s*$/i.test(text)) {
      await this.reply(threadId, HELP_TEXT);
      return true;
    }
    const talk = /^\/talk\s+(\S+)\s*$/i.exec(text);
    if (talk) {
      const ticket = this.services.tickets.get(talk[1]!);
      this.services.threads.bindTicket(actor, threadId, ticket.id);
      await this.reply(threadId, `Now talking to ${ticket.identifier} — ${ticket.title}. /conductor switches back.`);
      return true;
    }
    if (/^\/conductor\s*$/i.test(text)) {
      this.services.threads.bindTicket(actor, threadId, null);
      await this.reply(threadId, 'Back to the conductor.');
      return true;
    }
    const answer = /^\/d\s+(\S+)\s+([\s\S]+)$/i.exec(text);
    if (answer) {
      const id = answer[1]!;
      const raw = answer[2]!.trim();
      const decision = this.services.decisions.get(id);
      const numeric = /^\d+$/.test(raw) ? decision.options[Number(raw) - 1] : undefined;
      const byKey = decision.options.find((o) => o.key.toLowerCase() === raw.toLowerCase());
      const key = numeric?.key ?? byKey?.key;
      await this.services.decisions.answer(actor, id, key ? { key } : { text: raw });
      await this.reply(threadId, `Recorded: ${key ?? raw}`);
      return true;
    }
    return false;
  }

  private async reply(threadId: string, text: string): Promise<void> {
    await this.services.threads.outbound(SYSTEM, threadId, text).catch((e: unknown) => log.warn({ err: e }, 'ack failed'));
  }

  // ---------- events ----------

  private async onEvent(ev: WorkspaceEvent): Promise<void> {
    if (this.stopped) return;
    if (ev.type === 'thread.message') { await this.drain(); return; }
    if (ev.type === 'decision.created') await this.pushDecisionCard(ev.entityId);
  }

  /** Human-owned decisions are pushed to the primary thread as a card; degradation makes it text. */
  private async pushDecisionCard(decisionId: string): Promise<void> {
    if (this.cardsSent.has(decisionId)) return;
    try {
      const decision = this.services.decisions.get(decisionId);
      if (decision.owner !== 'human' || decision.status !== 'open') return;
      const thread = this.services.threads.primaryThread();
      if (!thread) { log.debug({ decisionId }, 'no primary thread for the decision card'); return; }
      this.cardsSent.add(decisionId);
      const message = decisionCard(decision);
      await this.services.threads.outbound(SYSTEM, thread.id, message.text, { parts: message.parts });
    } catch (e) {
      log.warn({ err: e, decisionId }, 'could not push a decision card');
    }
  }

  // ---------- outbound ----------

  /** Drains pending outbound rows. Serialised: one drain at a time per workspace. */
  async drain(): Promise<void> {
    if (this.draining || this.stopped) return;
    this.draining = true;
    try {
      for (const row of this.pending()) {
        const adapter = this.adapters.get(row.channelKind);
        if (!adapter) { this.mark(row.id, 'failed', null, row.attempts + 1); continue; }
        const message = degrade(toCanonical(row), adapter.capabilities);
        try {
          const result = await adapter.send({ threadExternalId: row.externalThreadId ?? row.threadId, message });
          if (result.delivered) { this.mark(row.id, 'delivered', result.externalMessageId ?? null, row.attempts + 1); continue; }
          this.retry(row, result.error?.retryable !== false);
        } catch (e) {
          const retryable = !(e instanceof Error && e.name === 'PermanentChannelError');
          log.warn({ err: e, messageId: row.id, kind: row.channelKind, retryable }, 'outbound delivery failed');
          this.retry(row, retryable);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private retry(row: PendingRow, retryable: boolean): void {
    const attempts = row.attempts + 1;
    if (!retryable || attempts >= MAX_ATTEMPTS) { this.mark(row.id, 'failed', null, attempts); return; }
    this.ctx.db.run('UPDATE thread_messages SET attempts = ? WHERE id = ?', [attempts, row.id]);
    const delay = Math.min(30_000, 2 ** attempts * 500);
    const timer = setTimeout(() => { void this.drain(); }, delay);
    timer.unref?.();
  }

  private pending(): PendingRow[] {
    return this.ctx.db.all<PendingRow>(
      `SELECT m.id AS id, m.thread_id AS thread_id, m.body AS body, m.parts_json AS parts_json, m.attempts AS attempts,
              t.external_thread_id AS external_thread_id, c.kind AS channel_kind
         FROM thread_messages m
         JOIN channel_threads t ON t.id = m.thread_id
         JOIN channels c ON c.id = t.channel_id
        WHERE m.direction = 'outbound' AND m.delivery_status = 'pending' AND m.attempts < ?
        ORDER BY m.created_at LIMIT 50`,
      [MAX_ATTEMPTS],
    );
  }

  private mark(id: string, status: 'delivered' | 'failed', externalMessageId: string | null, attempts: number): void {
    this.ctx.db.run('UPDATE thread_messages SET delivery_status = ?, external_message_id = COALESCE(?, external_message_id), attempts = ? WHERE id = ?',
      [status, externalMessageId, attempts, id]);
  }

  private ensureChannelRow(kind: string, config: Record<string, unknown>): void {
    // VS-125: `config` here is the *effective* config — for telegram it carries the real, resolved
    // token so the adapter can use it. Never let that value reach the database; `config_json` is
    // for debugging the non-secret shape of a channel's config, not a credential store.
    const { botToken: _redacted, ...stored } = config;
    const json = JSON.stringify(stored);
    const existing = this.ctx.db.get<{ id: string }>('SELECT id FROM channels WHERE workspace_id = ? AND kind = ?', [this.ctx.workspaceId, kind]);
    if (existing) {
      this.ctx.db.run('UPDATE channels SET config_json = ?, status = ?, last_error = NULL WHERE id = ?', [json, 'active', existing.id]);
      return;
    }
    this.ctx.db.run('INSERT INTO channels (id, workspace_id, kind, config_json, status) VALUES (?,?,?,?,?)',
      [newId(), this.ctx.workspaceId, kind, json, 'active']);
    log.debug({ kind, at: nowIso() }, 'channel row created');
  }

  /** The Telegram bot's username, as last confirmed by `getMe` at token-save time — never the token itself (VS-125). Upserts the row if the channel has never started (no token yet). `null` clears it. */
  setTelegramBotUsername(username: string | null): void {
    const existing = this.ctx.db.get<{ id: string }>('SELECT id FROM channels WHERE workspace_id = ? AND kind = ?', [this.ctx.workspaceId, 'telegram']);
    if (existing) {
      this.ctx.db.run('UPDATE channels SET bot_username = ? WHERE id = ?', [username, existing.id]);
      return;
    }
    this.ctx.db.run('INSERT INTO channels (id, workspace_id, kind, config_json, status, bot_username) VALUES (?,?,?,?,?,?)',
      [newId(), this.ctx.workspaceId, 'telegram', '{}', 'active', username]);
  }

  /** `null` when the channel has never saved a bot username. */
  telegramBotUsername(): string | null {
    return this.ctx.db.get<{ botUsername: string | null }>(
      "SELECT bot_username FROM channels WHERE workspace_id = ? AND kind = 'telegram'", [this.ctx.workspaceId],
    )?.botUsername ?? null;
  }
}

export function decisionCard(decision: Decision): CanonicalMessage {
  const body = [decision.context, decision.recommendation ? `Recommendation: ${decision.recommendation}` : null]
    .filter(Boolean).join('\n\n');
  const part: CanonicalPart = {
    type: 'card',
    title: decision.title,
    body,
    actions: decision.options.map((o) => ({ key: o.key, label: o.label, style: o.recommended ? 'primary' : 'default' })),
    ref: { kind: 'decision', id: decision.id },
  };
  return { parts: [part], text: `${decision.title}\n${body}` };
}

function toCanonical(row: PendingRow): CanonicalMessage {
  const parts = Array.isArray(row.parts) ? (row.parts as CanonicalPart[]) : [];
  if (!parts.length) return textMessage(row.body);
  const text = parts.map((p) => (p.type === 'text' ? p.text : p.type === 'quote' ? `> ${p.text}` : p.type === 'card' ? `${p.title}\n${p.body}` : '')).filter(Boolean).join('\n') || row.body;
  return { parts, text };
}
