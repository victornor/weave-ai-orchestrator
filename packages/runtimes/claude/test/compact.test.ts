import { describe, expect, it } from 'vitest';
import { compactArgs } from '../src/args.js';

const ID = '11111111-2222-4333-8444-555555555555';

describe('claude compact invocation', () => {
  it('resumes the session headlessly and runs the /compact slash command', () => {
    expect(compactArgs({ sessionId: ID })).toEqual(['-p', '--resume', ID, '--output-format', 'stream-json', '--verbose', '/compact']);
  });

  it('pins the model when the setting names one', () => {
    expect(compactArgs({ sessionId: ID, model: 'sonnet' })).toEqual(['-p', '--resume', ID, '--output-format', 'stream-json', '--verbose', '--model', 'sonnet', '/compact']);
  });

  it('omits the model flag when none is set', () => {
    expect(compactArgs({ sessionId: ID, model: null })).not.toContain('--model');
  });
});
