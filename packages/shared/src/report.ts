import { z } from 'zod';
import { REPORT_STATES } from './enums.js';

/**
 * The report's explicit knowledge decision (VS-102): either durable knowledge was recorded and
 * where, or none was and why. Required, with no default — a report missing it, or stating
 * `recorded: true` with no `where`, or `recorded: false` with no `reason`, fails to parse the same
 * way a report missing `state` does, so it is treated as no report at all (liveness `empty`).
 * "Nothing durable" is always a complete, unpenalised answer; nothing here judges the reason given.
 */
/** VS-943: report string limits. An over-long value is cut to the limit, ending in `…`, never rejected. */
export const REPORT_SUMMARY_MAX = 4000;
export const REPORT_KNOWLEDGE_TEXT_MAX = 200;
const cutTo = (max: number) => (v: string): string => (v.length > max ? `${v.slice(0, max - 1)}…` : v);

const KnowledgeReportSchema = z
  .object({
    recorded: z.boolean(),
    where: z.string().trim().min(1).nullish().transform((v) => (v == null ? undefined : cutTo(REPORT_KNOWLEDGE_TEXT_MAX)(v))),
    reason: z.string().trim().min(1).nullish().transform((v) => (v == null ? undefined : cutTo(REPORT_KNOWLEDGE_TEXT_MAX)(v))),
  })
  .refine((v) => (v.recorded ? Boolean(v.where) : Boolean(v.reason)), {
    message: 'knowledge.where is required when recorded is true; knowledge.reason is required when recorded is false',
  });

/** Structured final report every agent turn ends with (PLAN §9.4). */
export const RunReportSchema = z.object({
  state: z.enum(REPORT_STATES),
  summary: z.string().transform(cutTo(REPORT_SUMMARY_MAX)),
  tickets: z.array(z.object({ id: z.string(), status: z.string().nullish().transform((v) => v ?? undefined), note: z.string().nullish().transform((v) => v ?? undefined) })).default([]),
  nextAction: z.object({ owner: z.enum(['self', 'weaver', 'human', 'none']), what: z.string() }).nullish().transform((v) => v ?? undefined),
  knowledge: KnowledgeReportSchema,
  uncommittedWork: z.boolean().default(false),
});
export type RunReport = z.infer<typeof RunReportSchema>;
/** Strict structured-output schema: closed objects, every property required, optional values nullable. */
export const RUN_REPORT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    state: { type: 'string', enum: [...REPORT_STATES] },
    summary: { type: 'string' },
    tickets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string' }, status: { type: ['string', 'null'] }, note: { type: ['string', 'null'] } },
        required: ['id', 'status', 'note'],
      },
    },
    nextAction: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: { owner: { type: 'string', enum: ['self', 'weaver', 'human', 'none'] }, what: { type: 'string' } },
      required: ['owner', 'what'],
    },
    knowledge: {
      type: 'object',
      additionalProperties: false,
      properties: { recorded: { type: 'boolean' }, where: { type: ['string', 'null'] }, reason: { type: ['string', 'null'] } },
      required: ['recorded', 'where', 'reason'],
    },
    uncommittedWork: { type: 'boolean' },
  },
  required: ['state', 'summary', 'tickets', 'nextAction', 'knowledge', 'uncommittedWork'],
} as const;

/** JSON candidates in free text, best first: fenced ```json blocks last-to-first, then a trailing object. */
function reportCandidates(text: string): string[] {
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  const candidates = fences.map((m) => m[1]!.trim()).reverse();
  const trailing = text.trim().match(/(\{[\s\S]*\})\s*$/);
  if (trailing) candidates.push(trailing[1]!);
  return candidates;
}

/** Extract a report from free text: last fenced ```json block or trailing JSON object. `raw` is the payload before parsing. */
export function extractReportWithRaw(text: string | null | undefined): { report: RunReport; raw: unknown } | null {
  if (!text) return null;
  for (const c of reportCandidates(text)) {
    try { const raw: unknown = JSON.parse(c); const r = RunReportSchema.safeParse(raw); if (r.success) return { report: r.data, raw }; } catch { /* keep looking */ }
  }
  return null;
}

export function extractReport(text: string | null | undefined): RunReport | null {
  return extractReportWithRaw(text)?.report ?? null;
}

/**
 * VS-943: a payload that is report-shaped (an object with a valid `state`) but fails `RunReportSchema`
 * — e.g. `knowledge.recorded: false` with no `reason`. Returns the schema issues as `path: message`
 * strings, or null when there is no such payload (nothing report-shaped, or it parses cleanly).
 */
export function findInvalidReport(structured: unknown, text: string | null | undefined): string[] | null {
  const payloads: unknown[] = [structured];
  if (text) for (const c of reportCandidates(text)) { try { payloads.push(JSON.parse(c)); } catch { /* not JSON */ } }
  for (const p of payloads) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) continue;
    if (!(REPORT_STATES as readonly unknown[]).includes((p as { state?: unknown }).state)) continue;
    const r = RunReportSchema.safeParse(p);
    if (!r.success) return r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  }
  return null;
}

/** VS-943: the string fields of a raw report payload longer than their limit, which parsing truncates. */
export function overlongReportFields(raw: unknown): Array<{ field: string; length: number; limit: number }> {
  const out: Array<{ field: string; length: number; limit: number }> = [];
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const k = o['knowledge'] && typeof o['knowledge'] === 'object' ? (o['knowledge'] as Record<string, unknown>) : {};
  const check = (field: string, v: unknown, limit: number): void => {
    const len = typeof v === 'string' ? v.trim().length : 0;
    if (len > limit) out.push({ field, length: len, limit });
  };
  check('summary', o['summary'], REPORT_SUMMARY_MAX);
  check('knowledge.where', k['where'], REPORT_KNOWLEDGE_TEXT_MAX);
  check('knowledge.reason', k['reason'], REPORT_KNOWLEDGE_TEXT_MAX);
  return out;
}
