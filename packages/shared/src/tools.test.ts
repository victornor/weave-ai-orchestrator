import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMON_TOOLS, WEAVER_TOOLS, WORKER_ONLY_TOOLS, HUMAN_REPLY_TOOL, isHumanReplyToolEvent } from './tools.js';
import { ROUTINE_ACTIONS, ROUTINE_STATUSES } from './enums.js';

const event = (type: string, payload: Record<string, unknown> | null) => ({ type, payload });

describe('COMMON_TOOLS (VS-174)', () => {
  it('includes weave_incident for every agent', () => {
    expect(COMMON_TOOLS).toContain('weave_incident');
  });
});

describe('WEAVER_TOOLS (VS-220)', () => {
  it('includes the four routine tools', () => {
    expect(WEAVER_TOOLS).toContain('weave_routine_list');
    expect(WEAVER_TOOLS).toContain('weave_routine_create');
    expect(WEAVER_TOOLS).toContain('weave_routine_update');
    expect(WEAVER_TOOLS).toContain('weave_routine_remove');
  });
});

describe('WEAVER_TOOLS (VS-223)', () => {
  it('lists weave_decision_review on the weaver and not on COMMON_TOOLS', () => {
    expect(WEAVER_TOOLS).toContain('weave_decision_review');
    expect(COMMON_TOOLS).not.toContain('weave_decision_review');
  });
});

describe('incident read tools (VS-222)', () => {
  it('are weaver-only: in WEAVER_TOOLS, not in COMMON_TOOLS', () => {
    expect(WEAVER_TOOLS).toContain('weave_incident_list');
    expect(WEAVER_TOOLS).toContain('weave_incident_get');
    expect(COMMON_TOOLS).not.toContain('weave_incident_list');
    expect(COMMON_TOOLS).not.toContain('weave_incident_get');
    expect(COMMON_TOOLS).toContain('weave_incident');
  });
});

describe('incident resolve tool (VS-271)', () => {
  it('is weaver-only: in WEAVER_TOOLS, not in COMMON_TOOLS', () => {
    expect(WEAVER_TOOLS).toContain('weave_incident_resolve');
    expect(COMMON_TOOLS).not.toContain('weave_incident_resolve');
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
    expect(isHumanReplyToolEvent(event('tool.call', { id: 't2', name: 'weave_ticket_create' }))).toBe(false);
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

describe('agent-facing prose names only registered tools (VS-260)', () => {
  const registered = new Set<string>([...COMMON_TOOLS, ...WEAVER_TOOLS, ...WORKER_ONLY_TOOLS, HUMAN_REPLY_TOOL]);
  const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
  /**
   * `ac_`-prefixed identifiers that are deliberately not tool names (VS-260): the tmux pane option
   * `@ac_agent`, the Claude account-probe request id `ac_get_usage`, and the web auth cookie
   * `ac_session`. Listed by name so a future `ac_` sweep has to justify removing them.
   */
  const NON_TOOL_AC = new Set(['ac_agent', 'ac_get_usage', 'ac_session']);

  function proseFiles(): string[] {
    const out: string[] = [];
    const walk = (p: string) => {
      let entries: string[];
      try { entries = readdirSync(p); } catch { return; }
      for (const e of entries) {
        const full = join(p, e);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(md|tmpl|ts|tsx)$/.test(e)) out.push(full);
      }
    };
    for (const r of ['skills', 'templates', 'docs', 'packages/core/src/prompts']) walk(join(repoRoot, r));
    return out;
  }

  it('has no ac_-prefixed name anywhere in the registered set', () => {
    for (const name of registered) expect(name.startsWith('weave_')).toBe(true);
  });

  it('never names a tool the server does not register', () => {
    const offenders: string[] = [];
    for (const file of proseFiles()) {
      for (const m of readFileSync(file, 'utf8').matchAll(/(?<![\w-])weave_[a-z0-9]+(?:_[a-z0-9]+)*/g)) {
        const token = m[0];
        if (registered.has(token)) continue;
        // A wildcard/prefix form (`weave_spec_*`) is allowed when it prefixes a registered name.
        if ([...registered].some((n) => n.startsWith(`${token}_`))) continue;
        offenders.push(`${token} in ${file.slice(repoRoot.length)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never leaves an old ac_-prefixed tool name in agent-facing prose', () => {
    const leftovers: string[] = [];
    for (const file of proseFiles()) {
      for (const m of readFileSync(file, 'utf8').matchAll(/(?<![\w-])ac_[a-z0-9]+(?:_[a-z0-9]+)*/g)) {
        const token = m[0];
        if (NON_TOOL_AC.has(token)) continue;
        leftovers.push(`${token} in ${file.slice(repoRoot.length)}`);
      }
    }
    expect(leftovers).toEqual([]);
  });
});
