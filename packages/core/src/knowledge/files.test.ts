import { describe, expect, it } from 'vitest';
import { isHubStub, seedBody } from './files.js';

describe('isHubStub', () => {
  it('treats seed decisions.md as a stub', () => {
    expect(isHubStub(seedBody('decisions'))).toBe(true);
  });

  it('treats headings-only as a stub', () => {
    expect(isHubStub('# Shared conventions\n\n## House rules\n\n## Glossary\n')).toBe(true);
  });

  it('treats SHARED.md with a house-rule bullet as populated', () => {
    expect(isHubStub('# Shared conventions\n\n## House rules\n\n- Commit messages are imperative and scoped.\n')).toBe(false);
  });

  it('ignores fill-in hints and HTML comments', () => {
    expect(isHubStub('# Workspace\n\n<!-- Conductor-only. Budget 3000 tokens. -->\n\n## Portfolio\n\n(one line per project: id — purpose — default role)\n')).toBe(true);
  });
});
