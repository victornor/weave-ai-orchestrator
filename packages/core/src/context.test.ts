import { describe, expect, it } from 'vitest';
import { workspacePaths } from './context.js';

describe('workspacePaths', () => {
  it('resolves attachments alongside the other non-served workspace state', () => {
    const p = workspacePaths('/ws/acme');
    expect(p.attachments).toBe('/ws/acme/.agent-conductor/attachments');
    expect(p.attachments.startsWith(p.state)).toBe(true);
  });
});
