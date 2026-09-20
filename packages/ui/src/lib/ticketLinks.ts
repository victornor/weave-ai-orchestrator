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

function linkOutsideCode(segment: string): string {
  return segment.replace(TICKET_IDENTIFIER, (id) => `[${id}](#ticket:${id})`);
}

/** One non-fence line: split on inline code spans and rewrite only the text between them. */
function linkLine(line: string): string {
  const parts = line.split(/(`[^`]*`)/g);
  return parts.map((part, i) => (i % 2 === 1 ? part : linkOutsideCode(part))).join('');
}

/**
 * Rewrite ticket identifiers in markdown source, skipping inline code spans and fenced code blocks.
 * A fence opens and closes on a line that starts with three backticks, matching the renderer's own
 * fence rule; everything between is emitted untouched.
 */
export function linkTicketIdentifiers(source: string): string {
  const lines = source.split('\n');
  let inFence = false;
  return lines
    .map((line) => {
      if (/^```/.test(line)) {
        inFence = !inFence;
        return line;
      }
      return inFence ? line : linkLine(line);
    })
    .join('\n');
}
