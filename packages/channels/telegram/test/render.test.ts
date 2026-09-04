import { describe, expect, it } from 'vitest';
import { degrade, textMessage, type CanonicalMessage } from '@agent-conductor/channel-sdk';
import { chunkText, escapeMarkdownV2, quoteMarkdownV2, toMarkdownV2 } from '../src/markdown.js';
import { buildCalls, buildKeyboard } from '../src/render.js';
import { CallbackCodec, CALLBACK_MAX_BYTES, byteLength } from '../src/callbacks.js';
import { capabilities } from '../src/index.js';

const codec = new CallbackCodec();
const encode = (ref: { decisionId: string; key: string }): string => codec.encode(ref);

describe('markdown v2', () => {
  it('escapes every reserved character', () => {
    expect(escapeMarkdownV2('a.b-c!(d)')).toBe('a\\.b\\-c\\!\\(d\\)');
  });

  it('keeps bold and escapes the rest', () => {
    expect(toMarkdownV2('**Merge ACME-42?** now.')).toBe('*Merge ACME\\-42?* now\\.');
  });

  it('leaves code spans intact', () => {
    expect(toMarkdownV2('run `conductor attach w-1` now')).toBe('run `conductor attach w-1` now');
    expect(toMarkdownV2('```\nconst a = 1.0;\n```')).toBe('```\nconst a = 1.0;\n```');
  });

  it('renders blockquotes line by line', () => {
    expect(quoteMarkdownV2('hi.\nthere')).toBe('>hi\\.\n>there');
  });

  it('chunks on newline boundaries without splitting an escape', () => {
    const text = `${'a'.repeat(30)}\n${'b'.repeat(30)}`;
    expect(chunkText(text, 40)).toEqual(['a'.repeat(30), 'b'.repeat(30)]);
    const escaped = `${'a'.repeat(38)}\\.`;
    const chunks = chunkText(escaped, 39);
    expect(chunks.every((c) => !/[^\\]\\$/.test(c))).toBe(true);
  });
});

describe('callback data', () => {
  it('encodes short refs inline and round-trips them', () => {
    const data = codec.encode({ decisionId: 'dec_123', key: 'approve' });
    expect(data).toBe('d:dec_123:approve');
    expect(codec.decode(data)).toEqual({ decisionId: 'dec_123', key: 'approve' });
  });

  it('falls back to a hashed ref when 64 bytes would be exceeded', () => {
    const ref = { decisionId: 'dec_'.padEnd(60, 'x'), key: 'approve-with-a-long-key' };
    const data = codec.encode(ref);
    expect(byteLength(data)).toBeLessThanOrEqual(CALLBACK_MAX_BYTES);
    expect(data.startsWith('h:')).toBe(true);
    expect(codec.decode(data)).toEqual(ref);
  });

  it('returns null for unknown or malformed data', () => {
    expect(codec.decode('h:nope:nope')).toBeNull();
    expect(codec.decode('garbage')).toBeNull();
    expect(codec.decode('d:only')).toBeNull();
  });

  it('keys stay under the limit for every button of a card', () => {
    const keyboard = buildKeyboard(
      [{ key: 'approve', label: 'Approve' }, { key: 'reject', label: 'Reject' }],
      { kind: 'decision', id: 'dec_abc' },
      encode,
    );
    expect(keyboard.inline_keyboard).toHaveLength(2);
    for (const [button] of keyboard.inline_keyboard) expect(byteLength(button!.callback_data)).toBeLessThanOrEqual(CALLBACK_MAX_BYTES);
  });
});

describe('buildCalls', () => {
  it('renders text as one MarkdownV2 message with a plain fallback', () => {
    const calls = buildCalls(textMessage('hello **world**.'), { chatId: '42', encode });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('sendMessage');
    expect(calls[0]!.params).toMatchObject({ chat_id: '42', text: 'hello *world*\\.', parse_mode: 'MarkdownV2' });
    expect(calls[0]!.fallback).toMatchObject({ text: 'hello **world**.' });
    expect(calls[0]!.fallback!.parse_mode).toBeUndefined();
  });

  it('renders a card as its own message with one button per action', () => {
    const msg: CanonicalMessage = {
      text: 'Merge ACME-42?',
      parts: [
        { type: 'text', text: 'One decision:' },
        {
          type: 'card',
          title: 'Merge ACME-42?',
          body: 'CI is green.',
          actions: [{ key: 'approve', label: 'Approve', style: 'primary' }, { key: 'hold', label: 'Hold' }],
          ref: { kind: 'decision', id: 'dec_9' },
        },
      ],
    };
    const calls = buildCalls(msg, { chatId: '42', encode });
    expect(calls.map((c) => c.method)).toEqual(['sendMessage', 'sendMessage']);
    const card = calls[1]!;
    expect(card.params.text).toBe('*Merge ACME\\-42?*\n\nCI is green\\.');
    expect(card.params.reply_markup).toEqual({
      inline_keyboard: [
        [{ text: 'Approve', callback_data: 'd:dec_9:approve' }],
        [{ text: 'Hold', callback_data: 'd:dec_9:hold' }],
      ],
    });
  });

  it('uses reply_to for quotes when replying, and inlines them otherwise', () => {
    const msg: CanonicalMessage = { text: 'q', parts: [{ type: 'quote', text: 'earlier' }, { type: 'text', text: 'ok' }] };
    const replying = buildCalls(msg, { chatId: '42', encode, replyToMessageId: 7 });
    expect(replying[0]!.params.text).toBe('ok');
    expect(replying[0]!.params.reply_to_message_id).toBe(7);
    expect(replying[0]!.fallback!.reply_to_message_id).toBe(7);

    const standalone = buildCalls(msg, { chatId: '42', encode });
    expect(standalone[0]!.params.text).toBe('>earlier\n\nok');
    expect(standalone[0]!.params.reply_to_message_id).toBeUndefined();
  });

  it('sends inline file bytes as a multipart document and urls as a plain param', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const msg: CanonicalMessage = {
      text: '',
      parts: [
        { type: 'file', name: 'report.md', mime: 'text/markdown', data: bytes },
        { type: 'file', name: 'remote.pdf', mime: 'application/pdf', url: 'https://example.test/r.pdf' },
      ],
    };
    const calls = buildCalls(msg, { chatId: '42', encode });
    expect(calls[0]).toMatchObject({ method: 'sendDocument', file: { field: 'document', name: 'report.md', mime: 'text/markdown' } });
    expect(calls[1]!.params).toMatchObject({ document: 'https://example.test/r.pdf', caption: 'remote.pdf' });
  });

  it('splits long text across several messages', () => {
    const calls = buildCalls(textMessage('x'.repeat(50)), { chatId: '42', encode, textLimit: 20 });
    expect(calls.length).toBeGreaterThan(1);
    for (const c of calls) expect(String(c.params.text).length).toBeLessThanOrEqual(20);
  });

  it('degrade() is a no-op for telegram because it has buttons', () => {
    const msg: CanonicalMessage = {
      text: 'Merge?',
      parts: [{ type: 'card', title: 'Merge?', body: 'why', actions: [{ key: 'yes', label: 'Yes' }], ref: { kind: 'decision', id: 'dec_1' } }],
    };
    expect(capabilities.supportsButtons).toBe(true);
    expect(degrade(msg, capabilities)).toBe(msg);
    const degraded = degrade(msg, { ...capabilities, supportsButtons: false });
    expect(degraded.parts[0]).toMatchObject({ type: 'text' });
    expect(buildCalls(degraded, { chatId: '42', encode })[0]!.params.reply_markup).toBeUndefined();
    expect(String(degraded.text)).toContain('/d dec_1');
  });
});
