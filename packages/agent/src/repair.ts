export type Repaired = { ok: true; value: Record<string, unknown>; repaired: boolean } | { ok: false; error: string };

/** Close the brackets and braces a torn stream left open, innermost first. */
function closeStructure(s: string): string {
  const stack: string[] = [];
  let inStr = false; let esc = false;
  for (const ch of s) {
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  // A string cut off mid-value is truncated data, not missing structure: closing it would run a shortened path or half a file.
  if (inStr) return s;
  let out = s;
  // A key cut off before its value is dropped, never given a made-up value.
  out = out.replace(/,?\s*"(?:[^"\\]|\\.)*"\s*:\s*$/, '').replace(/,\s*$/, '');
  return out + stack.reverse().join('');
}

const asObject = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const dropTrailingCommas = (s: string): string => s.replace(/,\s*([}\]])/g, '$1');

/**
 * Tool-call arguments as a JSON object, or why not. Tries strict parse, then a Markdown fence
 * stripped, trailing commas removed, a JSON-encoded string holding the object unwrapped, and, only
 * when `closeTorn` is set, missing closing brackets added (never a cut-off string). A reply cut off by the output limit
 * must not be closed: a half-written `content` would be executed as if the model had finished.
 * Repair only closes structure; it never invents keys or values.
 */
export function repairArgs(text: string, opts: { closeTorn?: boolean } = {}): Repaired {
  const src = text.trim() === '' ? '{}' : text;
  const tries: Array<{ s: string; repaired: boolean }> = [{ s: src, repaired: false }];
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*(?:```)?$/i.exec(src.trim());
  const body = fenced ? fenced[1]! : src;
  if (fenced) tries.push({ s: body, repaired: true });
  tries.push({ s: dropTrailingCommas(body), repaired: true });
  if (opts.closeTorn) tries.push({ s: closeStructure(dropTrailingCommas(body)), repaired: true });
  let firstError = '';
  for (const t of tries) {
    try {
      let v: unknown = JSON.parse(t.s);
      let repaired = t.repaired;
      if (typeof v === 'string') { try { v = JSON.parse(v); repaired = true; } catch { /* stays a string */ } }
      const obj = asObject(v);
      if (obj) return { ok: true, value: obj, repaired };
      firstError ||= 'arguments must be a JSON object';
    } catch (e) { firstError ||= (e as Error).message; }
  }
  return { ok: false, error: firstError };
}

/** The text handed back to the model in place of running a call it did not form correctly. */
export function invalidToolMessage(name: string, error: string): string {
  return `the arguments for ${name} are not valid JSON (${error}). Send exactly one JSON object with the documented keys`;
}
