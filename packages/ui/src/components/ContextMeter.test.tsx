/** VS-554: the shared renderer of a `contextStrip` view-model. */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { contextStrip } from '@weave-ai/render';
import { ContextMeter } from './ContextMeter';

const known = (tokens: number) =>
  contextStrip({ usage: { contextTokens: tokens }, contextWindowTokens: 200_000, compactionAt: 0.92, hasRun: true });

describe('ContextMeter', () => {
  it('fills the track to the window fraction and marks the compaction point', () => {
    const view = known(82_000)!;
    const { container } = render(<ContextMeter view={view} compactionAt={0.92} />);
    expect(container.querySelector('[data-context-fill]')).toHaveStyle({ width: '41%' });
    expect(container.querySelector('[data-context-compaction]')).toHaveStyle({ left: '92%' });
    expect(container.querySelector('[data-context-label]')?.textContent).toBe('82k / 200k');
    expect(container.querySelector('[data-context-meter]')?.getAttribute('data-context-tone')).toBe('ok');
  });

  it('turns the fill over when the context is near or past the threshold', () => {
    const view = known(192_000)!;
    const { container } = render(<ContextMeter view={view} compactionAt={0.92} />);
    expect(container.querySelector('[data-context-fill]')).toHaveStyle({ width: '96%' });
    expect(container.querySelector('[data-context-meter]')?.getAttribute('data-context-tone')).toBe('over');
  });

  it('shows the count and the unknown-window reason without a bar', () => {
    const view = contextStrip({ usage: { contextTokens: 82_000 }, contextWindowTokens: null, hasRun: true })!;
    const { container } = render(<ContextMeter view={view} />);
    expect(container.querySelector('[role="meter"]')).toBeNull();
    expect(container.querySelector('[data-context-fill]')).toBeNull();
    expect(container.querySelector('[data-context-label]')?.textContent).toContain('82k');
    expect(container.querySelector('[data-context-label]')?.textContent).toContain('Context window unknown');
  });

  it('renders nothing for a null view', () => {
    const { container } = render(<ContextMeter view={null} />);
    expect(container.querySelector('[data-context-meter]')).toBeNull();
  });
});
