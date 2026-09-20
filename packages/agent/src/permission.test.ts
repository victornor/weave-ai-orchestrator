import { describe, expect, it } from 'vitest';
import { ALL_CORE_TOOLS, RESTRICTED_CORE_TOOLS, bashDenial, isAllowedByLists, modeToolNames, toolDenial } from './permission.js';

describe('permission modes', () => {
  it('offers only the read-only core tools in restricted', () => {
    expect([...modeToolNames('restricted')]).toEqual(['read', 'grep', 'glob', 'todo_write', 'task']);
    expect([...modeToolNames('auto')]).toEqual([...ALL_CORE_TOOLS]);
    expect([...modeToolNames('bypass')]).toEqual([...ALL_CORE_TOOLS]);
    expect([...RESTRICTED_CORE_TOOLS]).not.toContain('write');
  });

  it('matches the Claude aliases in allow and deny lists', () => {
    expect(isAllowedByLists('bash', { mode: 'auto', deniedTools: ['Bash'] })).toBe(false);
    expect(isAllowedByLists('edit', { mode: 'auto', firstTurn: true, allowedTools: ['Edit'] })).toBe(true);
    expect(isAllowedByLists('read', { mode: 'auto', firstTurn: true, allowedTools: ['Edit'] })).toBe(false);
  });

  it('explains why a removed tool was denied', () => {
    const modeAllows = (n: string): boolean => ['read', 'grep', 'glob'].includes(n);
    expect(toolDenial('write', { mode: 'restricted' }, modeAllows)?.text).toContain('Denied by permission mode "restricted"');
    expect(toolDenial('read', { mode: 'restricted' }, modeAllows)).toBeNull();
    expect(toolDenial('bash', { mode: 'auto', deniedTools: ['Bash'] }, () => true)?.reason).toContain('denied');
  });
});

describe('bash deny patterns', () => {
  const auto = { mode: 'auto' as const };
  it('refuses the accidents the shared conventions record', () => {
    expect(bashDenial('pkill -f x', auto)).not.toBeNull();
    expect(bashDenial('systemctl restart y', auto)).not.toBeNull();
    expect(bashDenial('weave daemon stop', auto)).not.toBeNull();
    expect(bashDenial('conductor daemon restart', auto)).not.toBeNull();
    expect(bashDenial('kill $(pgrep -f node)', auto)).not.toBeNull();
    expect(bashDenial('sudo rm -rf /tmp/x', auto)).not.toBeNull();
    expect(bashDenial('gh auth login', auto)).not.toBeNull();
    expect(bashDenial('git push origin main', auto)).not.toBeNull();
    expect(bashDenial('rm -rf /', auto)).not.toBeNull();
    expect(bashDenial('rm -rf $HOME', auto)).not.toBeNull();
  });
  it('names the rule in the refusal', () => {
    expect(bashDenial('pkill -f x', auto)?.text).toContain('pkill');
  });
  it('allows an ordinary command', () => {
    expect(bashDenial('git status', auto)).toBeNull();
    expect(bashDenial('pnpm test', auto)).toBeNull();
  });
  it('does not apply in bypass, and extends with the role list', () => {
    expect(bashDenial('pkill -f x', { mode: 'bypass' })).toBeNull();
    expect(bashDenial('danger cmd', { mode: 'auto', bashDeny: ['danger\\s+cmd'] })).not.toBeNull();
    expect(bashDenial('safe cmd', { mode: 'auto', bashDeny: ['danger\\s+cmd'] })).toBeNull();
  });
});