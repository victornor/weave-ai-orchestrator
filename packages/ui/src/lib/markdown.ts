/**
 * A deliberately small markdown renderer: knowledge files, plans, proposals
 * and briefs are all generated markdown, and a library would cost more than
 * the subset is worth. Everything is escaped before any markup is added.
 */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inline(s: string): string {
  return esc(s)
    .replace(/\[\[([a-z0-9][a-z0-9-]*)(?:\|([^\]]+))?\]\]/g, (_m, slug: string, label?: string) => `<a href="#doc:${slug}" class="ac-doclink">${label ?? slug}</a>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\W)\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t: string, h: string) =>
      /^(https?:|\/|#)/.test(h) ? `<a href="${h}" target="_blank" rel="noreferrer">${t}</a>` : `${t}`,
    );
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

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

    if (/^```/.test(line)) {
      flushPara();
      closeList();
      out.push(inCode ? '</code></pre>' : '<pre><code>');
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(esc(raw));
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
    para.push(line);
  }
  flushPara();
  closeList();
  if (inCode) out.push('</code></pre>');
  return out.join('\n');
}
