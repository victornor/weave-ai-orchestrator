import { describe, expect, it } from 'vitest';
import { sessionRetirementLabel } from './ui-status.js';

/** VS-656: the human sentence shown at a session retirement boundary. */
describe('sessionRetirementLabel', () => {
  it('names each recorded reason', () => {
    expect(sessionRetirementLabel('tool_contract')).toBe("the agent's tools changed at an upgrade");
    expect(sessionRetirementLabel('idle')).toBe('the conversation had been idle for a long time');
    expect(sessionRetirementLabel('runtime')).toBe("the session's runtime changed");
    expect(sessionRetirementLabel('reset')).toBe('the session was reset');
  });

  it('still says the conversation restarted for an unknown or absent reason', () => {
    expect(sessionRetirementLabel(null)).toBe('the conversation restarted here');
    expect(sessionRetirementLabel(undefined)).toBe('the conversation restarted here');
    expect(sessionRetirementLabel('something-else')).toBe('the conversation restarted here');
  });
});
