/**
 * A small JSON-Schema check for `submit_result` (S7). The run's `outputSchema` is
 * `RUN_REPORT_JSON_SCHEMA`, whose vocabulary is: `type` (including an array of type names),
 * `enum`, `required`, `properties`, `additionalProperties: false` and `items`. The repo has no
 * JSON-Schema library, and pulling one in for six keywords is not worth it; keywords this does not
 * know are ignored rather than failed, and the engine parses the accepted value again with its own
 * `RunReportSchema`. The function returns human-readable violations, one per line.
 */
type Schema = Record<string, unknown>;

const TYPE_NAMES = ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'] as const;

function matchesType(value: unknown, name: string): boolean {
  switch (name) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number';
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    case 'array': return Array.isArray(value);
    case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value);
    default: return true;
  }
}

function typeNames(schema: Schema): string[] {
  const t = schema['type'];
  if (typeof t === 'string') return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === 'string');
  return [];
}

function describeType(schema: Schema): string {
  const names = typeNames(schema).filter((n) => (TYPE_NAMES as readonly string[]).includes(n));
  return names.length > 1 ? `one of ${names.join(', ')}` : (names[0] ?? 'the expected type');
}

function short(value: unknown): string {
  try { const s = JSON.stringify(value); return s !== undefined && s.length > 80 ? `${s.slice(0, 77)}...` : (s ?? String(value)); }
  catch { return String(value); }
}

/** Validate `value` against the subset of JSON Schema the run schema uses; returns [] when it fits. */
export function validateAgainstSchema(value: unknown, schema: Schema, path = '$'): string[] {
  const out: string[] = [];
  const names = typeNames(schema);
  if (names.length > 0 && !names.some((n) => matchesType(value, n))) out.push(`${path}: expected ${describeType(schema)}, got ${short(value)}`);

  const allowed = schema['enum'];
  if (Array.isArray(allowed) && !allowed.some((a) => a === value)) out.push(`${path}: expected one of ${allowed.map(short).join(', ')}, got ${short(value)}`);

  if (Array.isArray(value) && typeof schema['items'] === 'object' && schema['items'] !== null) {
    const items = schema['items'] as Schema;
    value.forEach((v, i) => out.push(...validateAgainstSchema(v, items, `${path}[${i}]`)));
  }

  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const required = Array.isArray(schema['required']) ? schema['required'].filter((k): k is string => typeof k === 'string') : [];
    for (const key of required) if (!(key in record)) out.push(`${path}: missing required property "${key}"`);
    const properties = (typeof schema['properties'] === 'object' && schema['properties'] !== null ? schema['properties'] : {}) as Record<string, Schema>;
    for (const [key, sub] of Object.entries(properties)) {
      if (key in record && typeof sub === 'object' && sub !== null) out.push(...validateAgainstSchema(record[key], sub, `${path}.${key}`));
    }
    if (schema['additionalProperties'] === false) {
      for (const key of Object.keys(record)) if (!(key in properties)) out.push(`${path}: unexpected property "${key}"`);
    }
  }
  return out;
}