/**
 * Validation and field-listing for the per-runtime options a model setting carries
 * (`ModelSetting.options`). The schema is the adapter's own `configSchema()` — a JSON Schema object —
 * so the Models editor and the daemon validate against the same declaration the adapter runs with,
 * and a setting can never carry an option its runtime does not understand.
 */

/** The JSON Schema property shapes the runtime adapters declare. Unknown keywords are ignored. */
export interface RuntimeOptionProperty {
  type?: string;
  description?: string;
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  pattern?: string;
  items?: { type?: string };
}

export interface RuntimeOptionSchema { type?: string; properties?: Record<string, RuntimeOptionProperty>; additionalProperties?: boolean }

/** Options the editor leaves to a dedicated control (runtime/model/thinking), never a generated field. */
export const FIRST_CLASS_OPTION_KEYS = ['model', 'effort'] as const;

/** The schema's option fields, in declaration order, minus the ones with a first-class control. */
export function runtimeOptionProperties(schema: unknown): Array<[string, RuntimeOptionProperty]> {
  const props = schema && typeof schema === 'object' ? (schema as RuntimeOptionSchema).properties : undefined;
  if (!props || typeof props !== 'object') return [];
  return Object.entries(props).filter(([key]) => !(FIRST_CLASS_OPTION_KEYS as readonly string[]).includes(key));
}

export interface RuntimeOptionIssues { valid: boolean; byKey: Record<string, string> }

/**
 * Validate the runtime identity and adapter-specific options carried by worker catalog entries.
 * Runtime settings for the weaver/workers controls remain intentionally tolerant of an absent
 * adapter during config reads; a worker option is different because it is an explicit runnable
 * choice and must not be saved with an unknown runtime.
 */
export function workerOptionErrors(
  runtimeFor: (runtime: string) => { configSchema(): unknown } | undefined,
  options: ReadonlyArray<{ id: string; runtime?: string | null; options?: Record<string, unknown> }>,
): string[] {
  const out: string[] = [];
  for (const option of options) {
    if (!option.runtime) continue;
    const adapter = runtimeFor(option.runtime);
    if (!adapter) {
      out.push(`${option.id}: runtime '${option.runtime}' is not registered`);
      continue;
    }
    if (!option.options || Object.keys(option.options).length === 0) continue;
    const issues = validateRuntimeOptions(adapter.configSchema(), option.options);
    if (!issues.valid) out.push(`${option.id}: ${option.runtime}: ${Object.entries(issues.byKey).map(([k, v]) => `${k} ${v}`).join('; ')}`);
  }
  return out;
}

/**
 * Check `options` against a runtime's `configSchema()`. Unknown keys are refused only when the
 * schema says `additionalProperties: false`; a schema that cannot describe itself (no `properties`)
 * accepts everything, since there is nothing to validate against.
 */
export function validateRuntimeOptions(schema: unknown, options: Record<string, unknown> | undefined): RuntimeOptionIssues {
  const byKey: Record<string, string> = {};
  if (!options || typeof options !== 'object') return { valid: true, byKey };
  if (!schema || typeof schema !== 'object') return { valid: true, byKey };
  const shape = schema as RuntimeOptionSchema;
  if (!shape.properties) return { valid: true, byKey };
  for (const [key, value] of Object.entries(options)) {
    const prop = shape.properties[key];
    if (!prop) {
      if (shape.additionalProperties === false) byKey[key] = 'not an option this runtime understands';
      continue;
    }
    const issue = validateValue(prop, value);
    if (issue) byKey[key] = issue;
  }
  return { valid: Object.keys(byKey).length === 0, byKey };
}

/**
 * One message per setting whose options its runtime's schema rejects; empty when every setting is
 * fine. `schemaFor` resolves a runtime id to its `configSchema()` — the daemon's registry does this,
 * so both the workspace write path and the daemon overlay share one rule.
 */
export function runtimeOptionErrors(
  schemaFor: (runtime: string) => unknown,
  settings: ReadonlyArray<{ runtime?: string | null; options?: Record<string, unknown> } | null | undefined>,
): string[] {
  const out: string[] = [];
  for (const s of settings) {
    if (!s?.runtime || !s.options || Object.keys(s.options).length === 0) continue;
    const schema = schemaFor(s.runtime);
    if (!schema) continue;
    const issues = validateRuntimeOptions(schema, s.options);
    if (!issues.valid) out.push(`${s.runtime}: ${Object.entries(issues.byKey).map(([k, v]) => `${k} ${v}`).join('; ')}`);
  }
  return out;
}

function validateValue(prop: RuntimeOptionProperty, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  switch (prop.type) {
    case 'integer':
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return `must be a ${prop.type}`;
      if (prop.type === 'integer' && !Number.isInteger(value)) return 'must be an integer';
      if (prop.minimum !== undefined && value < prop.minimum) return `must be at least ${prop.minimum}`;
      if (prop.maximum !== undefined && value > prop.maximum) return `must be at most ${prop.maximum}`;
      if (prop.exclusiveMinimum !== undefined && value <= prop.exclusiveMinimum) return `must be greater than ${prop.exclusiveMinimum}`;
      if (prop.exclusiveMaximum !== undefined && value >= prop.exclusiveMaximum) return `must be less than ${prop.exclusiveMaximum}`;
      return null;
    }
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be true or false';
    case 'string':
      if (typeof value !== 'string') return 'must be text';
      if (prop.minLength !== undefined && value.length < prop.minLength) return `must be at least ${prop.minLength} characters`;
      if (prop.pattern !== undefined && !safePattern(prop.pattern).test(value)) return 'has the wrong format';
      if (prop.enum && !prop.enum.includes(value)) return `must be one of ${prop.enum.join(', ')}`;
      return null;
    case 'array':
      if (!Array.isArray(value)) return 'must be a list';
      if (prop.items?.type === 'string' && value.some((v) => typeof v !== 'string')) return 'must be a list of text values';
      return null;
    default:
      if (prop.enum && !prop.enum.includes(value)) return `must be one of ${prop.enum.join(', ')}`;
      return null;
  }
}

function safePattern(pattern: string): RegExp {
  try { return new RegExp(pattern); } catch { return /(?:)/; }
}
