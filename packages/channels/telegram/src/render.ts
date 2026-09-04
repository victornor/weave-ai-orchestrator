import type { CanonicalMessage, CanonicalPart } from '@openconductor/channel-sdk';
import { chunkText, quoteMarkdownV2, toMarkdownV2, TELEGRAM_TEXT_LIMIT } from './markdown.js';
import type { CallbackRef } from './callbacks.js';

export interface InlineButton { text: string; callback_data: string }
export interface InlineKeyboardMarkup { inline_keyboard: InlineButton[][] }

export interface TelegramCall {
  method: 'sendMessage' | 'sendDocument';
  params: Record<string, unknown>;
  /** Plain-text params used when MarkdownV2 parsing is rejected (HTTP 400). */
  fallback?: Record<string, unknown>;
  file?: { field: 'document'; name: string; mime: string; data: Uint8Array };
}

export interface RenderOptions {
  chatId: string;
  encode(ref: CallbackRef): string;
  /** When set, the first outgoing message is a reply to this message id and quote parts are dropped. */
  replyToMessageId?: number;
  textLimit?: number;
}

const isTextish = (p: CanonicalPart): boolean => p.type === 'text' || p.type === 'mention' || p.type === 'quote';

function renderTextish(part: CanonicalPart, opts: RenderOptions): { md: string; plain: string } | null {
  switch (part.type) {
    case 'text':
      return { md: toMarkdownV2(part.text), plain: part.text };
    case 'mention':
      return { md: toMarkdownV2(`@${part.label}`), plain: `@${part.label}` };
    case 'quote':
      // A real reply carries the context; only inline the quote when we cannot reply.
      if (opts.replyToMessageId != null) return null;
      return { md: quoteMarkdownV2(part.text), plain: part.text.split('\n').map((l) => `> ${l}`).join('\n') };
    default:
      return null;
  }
}

export function buildKeyboard(
  actions: Array<{ key: string; label: string; style?: string }>,
  ref: { kind: 'decision'; id: string },
  encode: (r: CallbackRef) => string,
): InlineKeyboardMarkup {
  return { inline_keyboard: actions.map((a) => [{ text: a.label, callback_data: encode({ decisionId: ref.id, key: a.key }) }]) };
}

/**
 * Render a CanonicalMessage into the sequence of Bot API calls that deliver it.
 * Pure: no IO, no clock, no randomness.
 */
export function buildCalls(msg: CanonicalMessage, opts: RenderOptions): TelegramCall[] {
  const limit = opts.textLimit ?? TELEGRAM_TEXT_LIMIT;
  const calls: TelegramCall[] = [];
  let mdBuf: string[] = [];
  let plainBuf: string[] = [];

  const flushText = (): void => {
    if (!mdBuf.length) return;
    const md = mdBuf.join('\n\n');
    const plain = plainBuf.join('\n\n');
    mdBuf = [];
    plainBuf = [];
    const mdChunks = chunkText(md, limit);
    const plainChunks = chunkText(plain, limit);
    mdChunks.forEach((chunk, i) => {
      calls.push({
        method: 'sendMessage',
        params: { chat_id: opts.chatId, text: chunk, parse_mode: 'MarkdownV2', link_preview_options: { is_disabled: true } },
        fallback: { chat_id: opts.chatId, text: plainChunks[i] ?? chunk, link_preview_options: { is_disabled: true } },
      });
    });
  };

  for (const part of msg.parts) {
    if (isTextish(part)) {
      const rendered = renderTextish(part, opts);
      if (rendered) { mdBuf.push(rendered.md); plainBuf.push(rendered.plain); }
      continue;
    }
    if (part.type === 'card') {
      flushText();
      const md = `${toMarkdownV2(`**${part.title}**`)}\n\n${toMarkdownV2(part.body)}`;
      const plain = `${part.title}\n\n${part.body}`;
      const reply_markup = buildKeyboard(part.actions, part.ref, opts.encode);
      calls.push({
        method: 'sendMessage',
        params: { chat_id: opts.chatId, text: md.slice(0, limit), parse_mode: 'MarkdownV2', reply_markup, link_preview_options: { is_disabled: true } },
        fallback: { chat_id: opts.chatId, text: plain.slice(0, limit), reply_markup, link_preview_options: { is_disabled: true } },
      });
      continue;
    }
    if (part.type === 'file') {
      flushText();
      if (part.data) {
        calls.push({
          method: 'sendDocument',
          params: { chat_id: opts.chatId, caption: part.name },
          file: { field: 'document', name: part.name, mime: part.mime, data: part.data },
        });
      } else if (part.url) {
        calls.push({ method: 'sendDocument', params: { chat_id: opts.chatId, document: part.url, caption: part.name } });
      } else {
        mdBuf.push(toMarkdownV2(`[file: ${part.name}]`));
        plainBuf.push(`[file: ${part.name}]`);
      }
    }
  }
  flushText();

  if (opts.replyToMessageId != null && calls[0]) {
    calls[0].params.reply_to_message_id = opts.replyToMessageId;
    if (calls[0].fallback) calls[0].fallback.reply_to_message_id = opts.replyToMessageId;
  }
  return calls;
}
