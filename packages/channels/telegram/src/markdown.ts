/** MarkdownV2 rendering helpers (Telegram Bot API). Pure functions, no IO. */

const SPECIAL = /[_*[\]()~`>#+\-=|{}.!\\]/g;

/** Escape every MarkdownV2 reserved character. */
export function escapeMarkdownV2(text: string): string {
  return text.replace(SPECIAL, (c) => `\\${c}`);
}

/** Escape the characters that are reserved inside code spans/blocks. */
export function escapeCode(text: string): string {
  return text.replace(/[\\`]/g, (c) => `\\${c}`);
}

const BOLD_MARK = '\u0000';

/**
 * Render a small subset of common markdown (fenced code, inline code, `**bold**`)
 * into Telegram MarkdownV2, escaping everything else.
 */
export function toMarkdownV2(text: string): string {
  const segments = text.split(/(```[\s\S]*?```|`[^`\n]+`)/g);
  return segments
    .map((seg, i) => {
      if (i % 2 === 1) {
        if (seg.startsWith('```')) return `\`\`\`${escapeCode(seg.slice(3, -3))}\`\`\``;
        return `\`${escapeCode(seg.slice(1, -1))}\``;
      }
      const marked = seg.replace(/\*\*([^*\n]+)\*\*/g, (_m, inner: string) => `${BOLD_MARK}${inner}${BOLD_MARK}`);
      return escapeMarkdownV2(marked).split(BOLD_MARK).join('*');
    })
    .join('');
}

/** MarkdownV2 blockquote (one `>` per line). */
export function quoteMarkdownV2(text: string): string {
  return text.split('\n').map((line) => `>${escapeMarkdownV2(line)}`).join('\n');
}

export const TELEGRAM_TEXT_LIMIT = 4096;

/**
 * Split rendered text into Telegram-sized chunks, preferring newline boundaries and
 * never cutting an escape sequence in half.
 */
export function chunkText(text: string, limit = TELEGRAM_TEXT_LIMIT): string[] {
  if (text.length <= limit) return text.length ? [text] : [];
  const out: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut <= 0) cut = limit;
    // never end a chunk on a dangling backslash (it would escape the split point)
    while (cut > 1 && rest[cut - 1] === '\\' && rest[cut - 2] !== '\\') cut -= 1;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest.length) out.push(rest);
  return out;
}
