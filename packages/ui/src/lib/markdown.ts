/**
 * A deliberately small markdown renderer: knowledge files, plans, proposals
 * and briefs are all generated markdown, and a library would cost more than
 * the subset is worth. Everything is escaped before any markup is added.
 */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Marks where an inline code span was, so it survives the doc-link/bold/italic/link passes below
 * untouched — those regexes don't know a `<code>` tag is off limits, and used to reinterpret
 * markdown-looking characters inside one (`` `**not bold**` `` rendered as `<strong>`). The marker
 * character can't occur in normal input; if it somehow does, restoring it below just leaves that
 * literal character in place, and the surrounding code span above will not become HTML.
 */
const CODE_MARK = '\u0000';

function isTableSep(line: string): boolean {
  if (!line.includes('|')) return false;
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  const cells = s.split('|');
  return cells.length > 0 && cells.every((c) => /^\s*:?-{3,}:?\s*$/.test(c));
}

function splitCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function inline(s: string): string {
  const spans: string[] = [];
  const withPlaceholders = esc(s).replace(/`([^`]+)`/g, (_m, c: string) => {
    spans.push(c);
    return `${CODE_MARK}${spans.length - 1}${CODE_MARK}`;
  });
  const rest = withPlaceholders
    .replace(/\[\[([a-z0-9][a-z0-9-]*)(?:\|([^\]]+))?\]\]/g, (_m, slug: string, label?: string) => `<a href="#doc:${slug}" class="ac-doclink">${label ?? slug}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\W)\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t: string, h: string) =>
      /^(https?:|\/|#)/.test(h) ? `<a href="${h}" target="_blank" rel="noreferrer">${t}</a>` : `${t}`,
    );
  return rest.replace(new RegExp(`${CODE_MARK}(\\d+)${CODE_MARK}`, 'g'), (_m, i: string) => {
    const c = spans[Number(i)]!;
    return `<code class="ac-copy" data-copy="${c}">${c}</code>`;
  });
}

/**
 * `breaks` makes a single newline inside a paragraph a hard break instead of a space. It is off by
 * default because most of what this renders is hard-wrapped generated markdown — knowledge files,
 * plans, briefs, charters — where every wrapped line would otherwise break. Composer text (thread
 * messages, ticket comments) is not wrapped: a newline there is one the human typed, so it opts in.
 */
export function markdownToHtml(src: string, opts: { breaks?: boolean } = {}): string {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let inCode = false;
  let codeLines: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let para: string[] = [];

  const flushPara = (): void => {
    if (para.length) {
      // The separator is substituted after `inline`, not before: the newlines survive escaping
      // untouched, so an inline span still spans a break the way it does when lines are reflowed.
      const body = inline(para.join(opts.breaks ? '\n' : ' '));
      out.push(`<p>${opts.breaks ? body.replace(/\n/g, '<br />') : body}</p>`);
      para = [];
    }
  };
  const closeList = (): void => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };
  // Buffered rather than streamed line by line: the copy button needs the block's whole exact
  // source in one `data-copy` attribute, and emitting it in one shot avoids the extra blank line
  // `<pre><code>` used to leave at the top and bottom of every block (one array entry per line,
  // joined with `\n`, put a bare newline right after the opening tag and right before the closing
  // one).
  const flushCode = (): void => {
    const raw = esc(codeLines.join('\n'));
    out.push(`<div class="ac-codeblock"><pre><code>${raw}</code></pre><button type="button" class="ac-copy-btn" data-copy="${raw}" aria-label="Copy code">Copy</button></div>`);
    codeLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = raw.replace(/\s+$/, '');

    if (/^```/.test(line)) {
      flushPara();
      closeList();
      if (inCode) flushCode();
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      codeLines.push(raw);
      continue;
    }
    if (!line.trim()) {
      flushPara();
      closeList();
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      closeList();
      const level = Math.min(6, h[1]!.length);
      out.push(`<h${level}>${inline(h[2]!)}</h${level}>`);
      continue;
    }
    if (/^(---|\*\*\*|___)\s*$/.test(line)) {
      flushPara();
      closeList();
      out.push('<hr />');
      continue;
    }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) {
      flushPara();
      closeList();
      out.push(`<blockquote>${inline(q[1]!)}</blockquote>`);
      continue;
    }
    const ul = /^[-*+]\s+(.*)$/.exec(line);
    const ol = /^(\d+)\.\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const want = ul ? 'ul' : 'ol';
      if (listType !== want) {
        closeList();
        out.push(`<${want}>`);
        listType = want;
      }
      const body = ul ? ul[1]! : ol![2]!;
      const task = /^\[([ xX])\]\s+(.*)$/.exec(body);
      out.push(task ? `<li data-task="${task[1]!.trim() ? 'done' : 'open'}">${inline(task[2]!)}</li>` : `<li>${inline(body)}</li>`);
      continue;
    }
    const next = (lines[i + 1] ?? '').replace(/\s+$/, '');
    if (line.includes('|') && isTableSep(next)) {
      flushPara();
      closeList();
      const header = splitCells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length) {
        const row = lines[i]!.replace(/\s+$/, '');
        if (!row.trim() || !row.includes('|') || isTableSep(row) || /^```/.test(row) || /^(#{1,6})\s+/.test(row)) break;
        rows.push(splitCells(row));
        i++;
      }
      i--;
      const th = header.map((c) => `<th>${inline(c)}</th>`).join('');
      const tr = rows.map((cells) => `<tr>${cells.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('');
      out.push(`<div class="ac-table"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`);
      continue;
    }
    para.push(line);
  }
  flushPara();
  closeList();
  if (inCode) flushCode();
  return out.join('\n');
}
