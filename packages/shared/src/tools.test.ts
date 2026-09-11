import { describe, expect, it } from 'vitest';
import { COMMON_TOOLS, CONDUCTOR_TOOLS, HUMAN_REPLY_TOOL, isHumanReplyToolEvent } from './tools.js';
import { ROUTINE_ACTIONS, ROUTINE_STATUSES } from './enums.js';

const event = (type: string, payload: Record<string, unknown> | null) => ({ type, payload });

describe('COMMON_TOOLS (VS-174)', () => {
  it('includes ac_incident for every agent', () => {
    expect(COMMON_TOOLS).toContain('ac_incident');
  });
});

describe('CONDUCTOR_TOOLS (VS-220)', () => {
  it('includes the four routine tools', () => {
    expect(CONDUCTOR_TOOLS).toContain('ac_routine_list');
    expect(CONDUCTOR_TOOLS).toContain('ac_routine_create');
    expect(CONDUCTOR_TOOLS).toContain('ac_routine_update');
    expect(CONDUCTOR_TOOLS).toContain('ac_routine_remove');
  });
});

describe('CONDUCTOR_TOOLS (VS-223)', () => {
  it('lists ac_decision_review on the conductor and not on COMMON_TOOLS', () => {
    expect(CONDUCTOR_TOOLS).toContain('ac_decision_review');
    expect(COMMON_TOOLS).not.toContain('ac_decision_review');
  });
});

describe('routine enums (VS-220)', () => {
  it('is active or paused, report or file_work', () => {
    expect(ROUTINE_STATUSES).toEqual(['active', 'paused']);
    expect(ROUTINE_ACTIONS).toEqual(['report', 'file_work']);
  });
});

describe('isHumanReplyToolEvent', () => {
  it('matches the call, the result and a denial for the reply tool', () => {
    expect(isHumanReplyToolEvent(event('tool.call', { id: 't1', name: HUMAN_REPLY_TOOL, input: { body: 'on it' } }))).toBe(true);
    expect(isHumanReplyToolEvent(event('tool.result', { id: 't1', name: HUMAN_REPLY_TOOL, content: 'ok' }))).toBe(true);
    expect(isHumanReplyToolEvent(event('tool.denied', { id: 't1', name: HUMAN_REPLY_TOOL }))).toBe(true);
  });

  it('matches whichever name key the adapter used', () => {
    expect(isHumanReplyToolEvent(event('tool.call', { tool: HUMAN_REPLY_TOOL }))).toBe(true);
    expect(isHumanReplyToolEvent(event('tool.call', { toolName: HUMAN_REPLY_TOOL }))).toBe(true);
  });

  it('does not match another tool', () => {
    expect(isHumanReplyToolEvent(event('tool.call', { id: 't2', name: 'ac_ticket_create' }))).toBe(false);
    expect(isHumanReplyToolEvent(event('tool.result', { id: 't2', name: 'Bash' }))).toBe(false);
  });

  it('does not match a non-tool event that merely mentions the name', () => {
    expect(isHumanReplyToolEvent(event('assistant.text', { text: `calling ${HUMAN_REPLY_TOOL}`, name: HUMAN_REPLY_TOOL }))).toBe(false);
    expect(isHumanReplyToolEvent(event('turn.completed', { name: HUMAN_REPLY_TOOL }))).toBe(false);
  });

  it('tolerates a missing payload or event', () => {
    expect(isHumanReplyToolEvent(event('tool.call', null))).toBe(false);
    expect(isHumanReplyToolEvent(null)).toBe(false);
    expect(isHumanReplyToolEvent(undefined)).toBe(false);
  });
});
