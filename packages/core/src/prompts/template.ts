/**
 * Minimal mustache-ish template engine used for charters, AGENTS.md files and briefs.
 * Supports: {{a.b}}, {{#each list}}…{{this}}/{{field}}…{{/each}}, {{#if x}}…{{/if}}, {{#unless x}}…{{/unless}}.
 * Deliberately tiny: no partials, no helpers, no escaping (output is markdown).
 */
export type TemplateData = Record<string, unknown>;

type Node =
  | { t: 'text'; v: string }
  | { t: 'var'; path: string }
  | { t: 'block'; kind: 'each' | 'if' | 'unless'; path: string; body: Node[] };

const TOKEN = /\{\{\s*(#each|#if|#unless|\/each|\/if|\/unless)?\s*([^{}]*?)\s*\}\}/g;

function parse(src: string): Node[] {
  const root: Node[] = [];
  const stack: Array<{ kind: 'each' | 'if' | 'unless'; path: string; body: Node[] }> = [];
  const push = (n: Node) => { (stack.length ? stack[stack.length - 1]!.body : root).push(n); };
  let last = 0;
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(src))) {
    if (m.index > last) push({ t: 'text', v: src.slice(last, m.index) });
    last = m.index + m[0].length;
    const tag = m[1] ?? '';
    const path = (m[2] ?? '').trim();
    if (tag === '#each' || tag === '#if' || tag === '#unless') {
      stack.push({ kind: tag.slice(1) as 'each' | 'if' | 'unless', path, body: [] });
    } else if (tag === '/each' || tag === '/if' || tag === '/unless') {
      const open = stack.pop();
      if (!open) continue; // unbalanced close: ignore
      push({ t: 'block', kind: open.kind, path: open.path, body: open.body });
    } else if (path) {
      push({ t: 'var', path });
    }
  }
  if (last < src.length) push({ t: 'text', v: src.slice(last) });
  while (stack.length) { const open = stack.pop()!; root.push({ t: 'block', kind: open.kind, path: open.path, body: open.body }); }
  return root;
}

function lookup(scopes: unknown[], path: string): unknown {
  if (path === 'this' || path === '.') return scopes[scopes.length - 1];
  const parts = path.split('.');
  for (let i = scopes.length - 1; i >= 0; i--) {
    let cur = scopes[i];
    let ok = true;
    for (const p of parts) {
      if (cur !== null && typeof cur === 'object' && p in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[p];
      else { ok = false; break; }
    }
    if (ok) return cur;
  }
  return undefined;
}

export function truthy(v: unknown): boolean {
  if (v === undefined || v === null || v === false) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.trim().length > 0;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  return true;
}

function stringify(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return v.map(stringify).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function exec(nodes: Node[], scopes: unknown[]): string {
  let out = '';
  for (const n of nodes) {
    if (n.t === 'text') out += n.v;
    else if (n.t === 'var') out += stringify(lookup(scopes, n.path));
    else {
      const v = lookup(scopes, n.path);
      if (n.kind === 'each') {
        const list = Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v as object) : [];
        for (const item of list) out += exec(n.body, [...scopes, item]);
      } else if (n.kind === 'if') { if (truthy(v)) out += exec(n.body, scopes); }
      else if (!truthy(v)) out += exec(n.body, scopes);
    }
  }
  return out;
}

export function renderTemplate(tmpl: string, data: TemplateData): string {
  return exec(parse(tmpl), [data]);
}
