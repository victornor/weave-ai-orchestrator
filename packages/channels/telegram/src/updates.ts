import type { InboundMessage } from '@agent-conductor/channel-sdk';
import type { CallbackRef } from './callbacks.js';

export interface TgUser { id: number; is_bot?: boolean; username?: string; first_name?: string; last_name?: string }
export interface TgChat { id: number; type?: string; title?: string; username?: string }
export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date?: number;
  text?: string;
  caption?: string;
  reply_to_message?: { message_id: number };
}
export interface TgCallbackQuery { id: string; from: TgUser; data?: string; message?: TgMessage }
export interface TelegramUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  channel_post?: TgMessage;
  callback_query?: TgCallbackQuery;
}

export type ParsedUpdate =
  | { kind: 'message'; userId: number; chatId: number; inbound: InboundMessage }
  | { kind: 'callback'; userId: number; chatId: number; callbackQueryId: string; data: string; ref: CallbackRef | null; inbound: InboundMessage | null }
  | { kind: 'ignored'; reason: string; userId?: number };

export function userLabel(user: TgUser | undefined): string | undefined {
  if (!user) return undefined;
  if (user.username) return `@${user.username}`;
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return name || undefined;
}

/** The `from` user of a message or callback update, whichever shape it is — `undefined` for anything without a sender. */
export function senderOf(update: TelegramUpdate): TgUser | undefined {
  return update.callback_query?.from ?? update.message?.from ?? update.edited_message?.from;
}

/** `username` and `displayName` split out for recording an identity (VS-135) — `userLabel` collapses them into one string, which is right for a transcript but wrong for a record meant to show both. */
export function senderIdentity(user: TgUser | undefined): { username?: string; displayName?: string } {
  if (!user) return {};
  const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return {
    ...(user.username ? { username: user.username } : {}),
    ...(displayName ? { displayName } : {}),
  };
}

/** Translate one Telegram update into the canonical inbound shape. Pure. */
export function parseUpdate(update: TelegramUpdate, decode: (data: string) => CallbackRef | null): ParsedUpdate {
  const cq = update.callback_query;
  if (cq) {
    const chatId = cq.message?.chat.id;
    if (chatId == null) return { kind: 'ignored', reason: 'callback_without_chat', userId: cq.from.id };
    const data = cq.data ?? '';
    const ref = data ? decode(data) : null;
    const inbound: InboundMessage | null = ref
      ? {
          externalThreadId: String(chatId),
          externalUserId: String(cq.from.id),
          text: '',
          ...(cq.message?.message_id != null ? { replyToExternalId: String(cq.message.message_id) } : {}),
          ...(userLabel(cq.from) ? { userLabel: userLabel(cq.from) as string } : {}),
          action: { decisionId: ref.decisionId, key: ref.key },
        }
      : null;
    return { kind: 'callback', userId: cq.from.id, chatId, callbackQueryId: cq.id, data, ref, inbound };
  }

  const msg = update.message ?? update.edited_message;
  if (!msg) return { kind: 'ignored', reason: 'unsupported_update' };
  if (!msg.from) return { kind: 'ignored', reason: 'message_without_sender' };
  if (msg.from.is_bot) return { kind: 'ignored', reason: 'bot_sender', userId: msg.from.id };
  const text = (msg.text ?? msg.caption ?? '').trim();
  if (!text) return { kind: 'ignored', reason: 'non_text_message', userId: msg.from.id };
  const label = userLabel(msg.from);
  return {
    kind: 'message',
    userId: msg.from.id,
    chatId: msg.chat.id,
    inbound: {
      externalThreadId: String(msg.chat.id),
      externalUserId: String(msg.from.id),
      externalMessageId: String(msg.message_id),
      text,
      ...(label ? { userLabel: label } : {}),
      ...(msg.reply_to_message ? { replyToExternalId: String(msg.reply_to_message.message_id) } : {}),
    },
  };
}
