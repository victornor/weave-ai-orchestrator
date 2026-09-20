/**
 * Ticket identifiers in agent text become clickable references (VS-349, VS-623).
 *
 * The one pattern lives here so no surface invents a second one. `linkTicketIdentifiers` is a pre-pass
 * on markdown source: it rewrites an identifier to an `[ID](#ticket:ID)` link, but only where the
 * identifier is prose — an identifier inside an inline code span or a fenced code block is left
 * byte-for-byte, because there it is literal text. `Markdown` renders the resulting anchor as the
 * bordered mono tag and turns a click into `onTicket`.
 */
export const TICKET_IDENTIFIER = /\b([A-Z][A-Z0-9]+-\d+)\b/g;

/** A fence opens and closes on a line that starts with three backticks (the renderer's own rule). */
function isFence(line: string): boolean {
  return /^```/.test(line);
}

/** One line split on inline code spans: prose at even indexes, the code spans themselves at odd. */
function lineSegments(line: string): string[] {
  return line.split(/(`[^`]*`)/g);
}

function linkOutsideCode(segment: string): string {
  return segment.replace(TICKET_IDENTIFIER, (id) => `[${id}](#ticket:${id})`);
}

/**
 * Rewrite ticket identifiers in markdown source, skipping inline code spans and fenced code blocks.
 * Everything inside code is emitted untouched.
 */
export function linkTicketIdentifiers(source: string): string {
  let inFence = false;
  return source
    .split('\n')
    .map((line) => {
      if (isFence(line)) {
        inFence = !inFence;
        return line;
      }
      return inFence ? line : lineSegments(line).map((part, i) => (i % 2 === 1 ? part : linkOutsideCode(part))).join('');
    })
    .join('\n');
}

/**
 * The ticket identifiers in markdown source, in the order they appear, with the ones inside inline
 * code spans and fenced code blocks left out. The same scan `linkTicketIdentifiers` uses — one
 * pattern, one notion of what is prose — so the chat's reference strip and its clickable tags cannot
 * disagree about what a message names.
 */
export function ticketIdentifiersIn(source: string): string[] {
  const found: string[] = [];
  let inFence = false;
  for (const line of source.split('\n')) {
    if (isFence(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    for (const [i, part] of lineSegments(line).entries()) {
      // Prose only: the odd segments are the code spans themselves.
      if (i % 2 === 1) continue;
      for (const match of part.matchAll(TICKET_IDENTIFIER)) {
        const id = match[1];
        if (id) found.push(id);
      }
    }
  }
  return found;
}
