import { describe, expect, it } from 'vitest';
import { assignMcpToolNames, MAX_TOOL_NAME, sanitizeSegment } from './naming.js';

const WEAVE = 'weave-ai';

describe('MCP tool naming', () => {
  it('leaves the Weave server unprefixed and prefixes every other server', () => {
    const map = assignMcpToolNames([
      { server: WEAVE, tools: ['weave_ticket_get'] },
      { server: 'github', tools: ['search'] },
    ], new Set(['weave_ticket_get']), WEAVE);
    expect([...map.keys()]).toEqual(['weave_ticket_get', 'mcp__github__search']);
    expect(map.get('mcp__github__search')).toEqual({ server: 'github', tool: 'search' });
  });

  it('suffixes a collision between two servers whose names sanitise the same', () => {
    const map = assignMcpToolNames([
      { server: 'a.b', tools: ['c'] },
      { server: 'a/b', tools: ['c'] },
    ], new Set<string>(), WEAVE);
    const names = [...map.keys()];
    expect(names).toHaveLength(2);
    expect(names).toContain('mcp__a_b__c');
    expect(names.some((n) => /^mcp__a_b__c_\d+$/.test(n))).toBe(true);
    expect([...map.values()]).toEqual(expect.arrayContaining([{ server: 'a.b', tool: 'c' }, { server: 'a/b', tool: 'c' }]));
  });

  it('sanitises and truncates to 64 characters', () => {
    expect(sanitizeSegment('a.b/c d')).toBe('a_b_c_d');
    const long = 'x'.repeat(200);
    const map = assignMcpToolNames([{ server: long, tools: [long] }], new Set<string>(), WEAVE);
    const name = [...map.keys()][0]!;
    expect(name.length).toBeLessThanOrEqual(MAX_TOOL_NAME);
    expect(name.startsWith('mcp__xxx')).toBe(true);
    expect(map.get(name)).toEqual({ server: long, tool: long });
  });

  it('does not shadow a Weave name with another server', () => {
    const map = assignMcpToolNames([
      { server: WEAVE, tools: ['weave_ticket_get'] },
      { server: 'x', tools: ['weave_ticket_get'] },
    ], new Set(['weave_ticket_get']), WEAVE);
    const names = [...map.keys()];
    expect(names).toContain('weave_ticket_get');
    expect(names).toContain('mcp__x__weave_ticket_get');
    expect(names.filter((n) => n === 'weave_ticket_get')).toHaveLength(1);
  });
});
