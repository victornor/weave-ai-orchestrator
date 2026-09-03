import { z } from 'zod';
import { REPORT_STATES } from './enums.js';

/** Structured final report every agent turn ends with (PLAN §9.4). */
export const RunReportSchema = z.object({
  state: z.enum(REPORT_STATES),
  summary: z.string().max(4000),
  tickets: z.array(z.object({ id: z.string(), status: z.string().optional(), note: z.string().optional() })).default([]),
  nextAction: z.object({ owner: z.enum(['self', 'conductor', 'human', 'none']), what: z.string() }).optional(),
  knowledgeUpdated: z.boolean().default(false),
  uncommittedWork: z.boolean().default(false),
});
export type RunReport = z.infer<typeof RunReportSchema>;
export const RUN_REPORT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    state: { type: 'string', enum: [...REPORT_STATES] },
    summary: { type: 'string' },
    tickets: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string' }, note: { type: 'string' } }, required: ['id'] } },
    nextAction: { type: 'object', properties: { owner: { type: 'string', enum: ['self', 'conductor', 'human', 'none'] }, what: { type: 'string' } }, required: ['owner', 'what'] },
    knowledgeUpdated: { type: 'boolean' },
    uncommittedWork: { type: 'boolean' },
  },
  required: ['state', 'summary'],
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
