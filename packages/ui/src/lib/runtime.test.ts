import { describe, expect, it } from 'vitest';
import { modelOptionLabel } from './runtime';

describe('modelOptionLabel', () => {
  it('shows both the name and the id when they differ', () => {
    expect(modelOptionLabel({ id: 'deepseek-flash', label: 'DeepSeek V4.1 Flash' })).toBe('DeepSeek V4.1 Flash (deepseek-flash)');
  });

  it('shows the id once when there is no better name', () => {
    expect(modelOptionLabel({ id: 'anthropic/claude-sonnet-5', label: 'anthropic/claude-sonnet-5' })).toBe('anthropic/claude-sonnet-5');
  });
});
