import { describe, expect, it } from 'vitest';
import { HUMAN_REPLY_TOOL, isHumanReplyToolEvent } from './tools.js';

const event = (type: string, payload: Record<string, unknown> | null) => ({ type, payload });

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
