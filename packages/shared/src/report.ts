import { z } from 'zod';
import { REPORT_STATES } from './enums.js';

/**
 * The report's explicit knowledge decision (VS-102): either durable knowledge was recorded and
 * where, or none was and why. Required, with no default — a report missing it, or stating
 * `recorded: true` with no `where`, or `recorded: false` with no `reason`, fails to parse the same
 * way a report missing `state` does, so it is treated as no report at all (liveness `empty`).
 * "Nothing durable" is always a complete, unpenalised answer; nothing here judges the reason given.
 */
const KnowledgeReportSchema = z
  .object({
    recorded: z.boolean(),
    where: z.string().trim().min(1).max(200).optional(),
    reason: z.string().trim().min(1).max(200).optional(),
  })
  .refine((v) => (v.recorded ? Boolean(v.where) : Boolean(v.reason)), {
    message: 'knowledge.where is required when recorded is true; knowledge.reason is required when recorded is false',
  });

/** Structured final report every agent turn ends with (PLAN §9.4). */
export const RunReportSchema = z.object({
  state: z.enum(REPORT_STATES),
  summary: z.string().max(4000),
  tickets: z.array(z.object({ id: z.string(), status: z.string().optional(), note: z.string().optional() })).default([]),
  nextAction: z.object({ owner: z.enum(['self', 'weaver', 'human', 'none']), what: z.string() }).optional(),
  knowledge: KnowledgeReportSchema,
  uncommittedWork: z.boolean().default(false),
});
export type RunReport = z.infer<typeof RunReportSchema>;
export const RUN_REPORT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    state: { type: 'string', enum: [...REPORT_STATES] },
    summary: { type: 'string' },
    tickets: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string' }, note: { type: 'string' } }, required: ['id'] } },
    nextAction: { type: 'object', properties: { owner: { type: 'string', enum: ['self', 'weaver', 'human', 'none'] }, what: { type: 'string' } }, required: ['owner', 'what'] },
    knowledge: {
      type: 'object',
      properties: { recorded: { type: 'boolean' }, where: { type: 'string' }, reason: { type: 'string' } },
      required: ['recorded'],
    },
    uncommittedWork: { type: 'boolean' },
  },
  required: ['state', 'summary', 'knowledge'],
} as const;

/** Extract a report from free text: last fenced ```json block or trailing JSON object. */
export function extractReport(text: string | null | undefined): RunReport | null {
  if (!text) return null;
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  const candidates = fences.map((m) => m[1]!.trim()).reverse();
  const trailing = text.trim().match(/(\{[\s\S]*\})\s*$/);
  if (trailing) candidates.push(trailing[1]!);
  for (const c of candidates) {
    try { const r = RunReportSchema.safeParse(JSON.parse(c)); if (r.success) return r.data; } catch { /* keep looking */ }
  }
  return null;
}
