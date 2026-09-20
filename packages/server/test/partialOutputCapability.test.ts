/**
 * VS-615: whether a run can stream comes from each adapter's declared `capabilities.partialOutput`,
 * not from a table of runtime ids. This pins what the existing runtimes declare, so moving the
 * source of truth changed nothing for them, and shows a new runtime needs no shared-package edit.
 */
import { describe, expect, it } from 'vitest';
import { partialOutputOf, runtimePartialOutput } from '@weave-ai/render';
import { adapter as claude } from '@weave-ai/runtime-claude';
import { adapter as codex } from '@weave-ai/runtime-codex';
import { adapter as cursor } from '@weave-ai/runtime-cursor';
import { adapter as gemini } from '@weave-ai/runtime-gemini';
import { adapter as opencode } from '@weave-ai/runtime-opencode';
import { adapter as weave } from '@weave-ai/runtime-weave';

const adapters = [opencode, claude, codex, cursor, gemini, weave];

describe('partial output capability', () => {
  it('reads what the five existing runtimes and weave declare (golden)', () => {
    const list = adapters.map((a) => ({ id: a.id, capabilities: a.capabilities }));
    expect(Object.fromEntries(list.map((r) => [r.id, runtimePartialOutput(list, r.id)]))).toEqual({
      opencode: 'full', claude: 'full', codex: 'full', cursor: 'text', gemini: 'text', weave: 'full',
    });
  });

  it('treats an undeclared, unknown or malformed capability as whole steps only, and needs no table for a new runtime', () => {
    expect(partialOutputOf(undefined)).toBe('none');
    expect(partialOutputOf({})).toBe('none');
    expect(partialOutputOf({ partialOutput: 'everything' })).toBe('none');
    expect(runtimePartialOutput([], 'claude')).toBe('none');
    expect(runtimePartialOutput(null, 'claude')).toBe('none');
    expect(runtimePartialOutput([{ id: 'brand-new', capabilities: { partialOutput: 'full' } }], 'brand-new')).toBe('full');
  });
});
