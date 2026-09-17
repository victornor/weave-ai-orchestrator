import { describe, expect, it } from 'vitest';
import { parseListenUrl, splitModel, summarizePath } from '../src/compact.js';

describe('opencode compact helpers', () => {
  it('builds the v1 summarize path with the directory the session lives in', () => {
    expect(summarizePath('ses_abc', '/tmp/work')).toBe('/session/ses_abc/summarize?directory=%2Ftmp%2Fwork');
  });

  it('url-encodes a session id that needs it', () => {
    expect(summarizePath('ses a/b', '/x')).toBe('/session/ses%20a%2Fb/summarize?directory=%2Fx');
  });

  it('pulls the base url out of whatever `opencode serve` prints it beside', () => {
    expect(parseListenUrl('opencode server listening on http://127.0.0.1:4621')).toBe('http://127.0.0.1:4621');
    expect(parseListenUrl('  HTTP server at https://127.0.0.1:9/')).toBe('https://127.0.0.1:9');
    expect(parseListenUrl('no url here')).toBeNull();
  });

  it('splits provider/model for the summarize payload, refusing an unqualified id', () => {
    expect(splitModel('cheaper-inference/deepseek-v4.1-flash')).toEqual({ providerID: 'cheaper-inference', modelID: 'deepseek-v4.1-flash' });
    expect(splitModel('opencode/gpt-5.6-luna')).toEqual({ providerID: 'opencode', modelID: 'gpt-5.6-luna' });
    expect(splitModel('sonnet')).toBeNull();
    expect(splitModel(null)).toBeNull();
    expect(splitModel('a/')).toBeNull();
  });
});
