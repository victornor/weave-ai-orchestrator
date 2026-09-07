import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { contextStrip } from '@agent-conductor/render';
import { ContextMeter } from '../components/ContextMeter';

const usage = { inputTokens: 320_119, cachedInputTokens: 667_671, outputTokens: 1_022, contextTokens: 82_000 };
const view = (over: Partial<Parameters<typeof contextStrip>[0]> = {}) =>
  contextStrip({ usage, contextWindowTokens: 200_000, compactionAt: 0.92, hasRun: true, ...over });

afterEach(cleanup);

describe('ContextMeter', () => {
  it('shows the fraction of the window and the distance to compaction', () => {
    render(<ContextMeter view={view()} />);
    expect(screen.getByText('Context')).toBeTruthy();
    expect(screen.getByText('41%')).toBeTruthy();
    expect(screen.getByText('· 45% to compaction')).toBeTruthy();
  });

  it('keeps the token count on hover rather than in the header', () => {
    render(<ContextMeter view={view()} />);
    expect(screen.queryByText(/82k/)).toBeNull();
    expect(screen.getByTestId('context-meter').getAttribute('title')).toBe(
      "Context 82k of 200k tokens · 45% of the way to this runtime's compaction point",
    );
  });

  it('drops the compaction clause for a runtime that does not compact', () => {
    render(<ContextMeter view={view({ compactionAt: null })} />);
    expect(screen.getByText('41%')).toBeTruthy();
    expect(screen.queryByText(/to compaction/)).toBeNull();
  });

  it('shows nothing before the conductor has finished a turn', () => {
    const { container } = render(<ContextMeter view={view({ hasRun: false })} />);
    expect(container.innerHTML).toBe('');
  });

  it('gives one quiet reason, and no percentage, when the model window is unknown', () => {
    render(<ContextMeter view={view({ contextWindowTokens: null })} />);
    expect(screen.getByText('Context window unknown')).toBeTruthy();
    expect(screen.queryByText('41%')).toBeNull();
    expect(screen.queryByText('0%')).toBeNull();
  });

  it('gives one quiet reason when the turn reported no tokens, and still says how many', () => {
    render(<ContextMeter view={view({ usage: null })} />);
    expect(screen.getByText('Context size unreported')).toBeTruthy();
    expect(screen.getByTestId('context-meter').getAttribute('title')).toContain('reported 0 tokens');
    expect(screen.queryByText('0%')).toBeNull();
  });
});
