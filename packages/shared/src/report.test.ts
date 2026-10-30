import { describe, expect, it } from 'vitest';
import { RUN_REPORT_JSON_SCHEMA, RunReportSchema, extractReport } from './report.js';

function base(knowledge: unknown): Record<string, unknown> {
  return { state: 'working', summary: 'did the thing', knowledge };
}

describe('RunReportSchema.knowledge', () => {
  it('accepts a report that recorded something durable, with a location', () => {
    const r = RunReportSchema.safeParse(base({ recorded: true, where: 'PROJECT.md · Landmines' }));
    expect(r.success).toBe(true);
  });

  it('accepts a report that recorded nothing, with a reason — "nothing durable" is a complete answer', () => {
    const r = RunReportSchema.safeParse(base({ recorded: false, reason: 'nothing beyond the ticket itself' }));
    expect(r.success).toBe(true);
  });

  it('rejects a report missing the knowledge field entirely', () => {
    const { knowledge: _drop, ...rest } = base({ recorded: false, reason: 'x' });
    void _drop;
    const r = RunReportSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it('rejects recorded:true with no where', () => {
    const r = RunReportSchema.safeParse(base({ recorded: true }));
    expect(r.success).toBe(false);
  });

  it('rejects recorded:false with no reason', () => {
    const r = RunReportSchema.safeParse(base({ recorded: false }));
    expect(r.success).toBe(false);
  });

  it('never grades the content of a stated reason: a terse one is accepted like any other', () => {
    const r = RunReportSchema.safeParse(base({ recorded: false, reason: 'n/a' }));
    expect(r.success).toBe(true);
  });

  it('the JSON-schema requires knowledge and uses nullable values for optional details', () => {
    expect(RUN_REPORT_JSON_SCHEMA.required).toContain('knowledge');
    expect(RUN_REPORT_JSON_SCHEMA.properties.knowledge.required).toEqual(['recorded', 'where', 'reason']);
  });
});

describe('extractReport with the knowledge field', () => {
  const wrap = (obj: unknown): string => `Some prose.\n\n\`\`\`json\n${JSON.stringify(obj)}\n\`\`\`\n`;

  it('extracts a complete report', () => {
    const text = wrap(base({ recorded: true, where: 'a linked document' }));
    expect(extractReport(text)?.knowledge).toEqual({ recorded: true, where: 'a linked document' });
  });

  it('returns null for a report missing the knowledge field, the same as one missing state', () => {
    expect(extractReport(wrap({ state: 'working', summary: 'x' }))).toBeNull();
    const { state: _drop, ...rest } = base({ recorded: false, reason: 'x' });
    void _drop;
    expect(extractReport(wrap(rest))).toBeNull();
  });

  it('returns null for recorded:true with no where, and recorded:false with no reason', () => {
    expect(extractReport(wrap(base({ recorded: true })))).toBeNull();
    expect(extractReport(wrap(base({ recorded: false })))).toBeNull();
  });
});


describe('strict structured report compatibility', () => {
  it.each([
    { recorded: true, where: 'PROJECT.md', reason: null },
    { recorded: false, where: null, reason: 'Nothing durable' },
  ])('accepts nullable optional values and keeps the knowledge decision valid: %j', (knowledge) => {
    const report = RunReportSchema.parse({
      state: 'idle', summary: 'Complete', tickets: [{ id: 'TST-1', status: null, note: null }],
      nextAction: null, knowledge, uncommittedWork: false,
    });
    expect(report.nextAction).toBeUndefined();
    expect(report.tickets[0]?.status).toBeUndefined();
    expect(report.tickets[0]?.note).toBeUndefined();
    expect(report.knowledge).toEqual(knowledge.recorded
      ? { recorded: true, where: 'PROJECT.md', reason: undefined }
      : { recorded: false, where: undefined, reason: 'Nothing durable' });
    expect(extractReport(JSON.stringify({ ...report, nextAction: null }))).not.toBeNull();
  });

  it.each([true, false])('still rejects a knowledge decision without its required explanation: %j', (recorded) => {
    expect(RunReportSchema.safeParse({ state: 'idle', summary: 'x', knowledge: { recorded, where: null, reason: null } }).success).toBe(false);
  });

  it('does not turn required values into optional nullable values', () => {
    expect(RunReportSchema.safeParse({ state: null, summary: 'x', knowledge: { recorded: false, reason: 'x' } }).success).toBe(false);
    expect(RunReportSchema.safeParse({ state: 'idle', summary: null, knowledge: { recorded: false, reason: 'x' } }).success).toBe(false);
  });
});

describe('over-long fields (VS-943)', () => {
  it('truncates an over-long knowledge.reason to the limit, ending in an ellipsis, and keeps the report', () => {
    const r = RunReportSchema.safeParse(base({ recorded: false, reason: 'x'.repeat(220) }));
    expect(r.success && r.data.knowledge.reason).toBe(`${'x'.repeat(199)}…`);
  });
  it('truncates an over-long summary', () => {
    const r = RunReportSchema.safeParse({ ...base({ recorded: false, reason: 'ok' }), summary: 's'.repeat(4500) });
    expect(r.success && r.data.summary.length).toBe(4000);
  });
  it('still rejects a missing reason', () => {
    expect(RunReportSchema.safeParse(base({ recorded: false })).success).toBe(false);
  });
});
