import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { contextStrip } from '@weave-ai/render';
import { ContextMeter } from '../components/ContextMeter';

const usage = { inputTokens: 320_119, cachedInputTokens: 667_671, outputTokens: 1_022, contextTokens: 82_000 };
const view = (over: Partial<Parameters<typeof contextStrip>[0]> = {}) =>
  contextStrip({ usage, contextWindowTokens: 200_000, compactionAt: 0.92, hasRun: true, ...over });

afterEach(cleanup);

describe('ContextMeter', () => {
  it('leads with the raw token count, not a percentage, and names the distance to compaction (VS-129)', () => {
    // A percentage is only as trustworthy as its denominator, which has been wrong before — the
    // headline is the count a human can check against reality on sight; the bar carries the
    // proportion visually, and the only percentage left in words is the distance to compaction.
    render(<ContextMeter view={view()} />);
    expect(screen.getByText('Context')).toBeTruthy();
    expect(screen.getByText('82k')).toBeTruthy();
    expect(screen.queryByText('41%')).toBeNull();
    expect(screen.getByText('· 45% to compaction')).toBeTruthy();
  });

  it('carries the window and the compaction fraction on hover, beyond what the headline shows', () => {
    render(<ContextMeter view={view()} />);
    expect(screen.getByTestId('context-meter').getAttribute('title')).toBe(
      "Context 82k of 200k tokens · 45% of the way to this runtime's compaction point",
    );
  });

  it('drops the compaction clause for a runtime that does not compact', () => {
    render(<ContextMeter view={view({ compactionAt: null })} />);
    expect(screen.getByText('82k')).toBeTruthy();
    expect(screen.queryByText(/to compaction/)).toBeNull();
  });

  it('shows nothing before the conductor has finished a turn', () => {
    const { container } = render(<ContextMeter view={view({ hasRun: false })} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows the bare size, no bar and no percentage, when the model window is unknown (VS-129)', () => {
    // The size is still known even though the window is not — showing it beats the quiet reason
    // line, which is exactly the case where a wrong or missing denominator matters most.
    render(<ContextMeter view={view({ contextWindowTokens: null })} />);
    expect(screen.getByText('Context')).toBeTruthy();
    expect(screen.getByText('82k')).toBeTruthy();
    expect(screen.queryByText('Context window unknown')).toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
    expect(document.querySelector('[aria-hidden]')).toBeNull();
  });

  it('gives one quiet reason when the turn reported no tokens, and still says how many', () => {
    render(<ContextMeter view={view({ usage: null })} />);
    expect(screen.getByText('Context size unreported')).toBeTruthy();
    expect(screen.getByTestId('context-meter').getAttribute('title')).toContain('reported 0 tokens');
    expect(screen.queryByText('0%')).toBeNull();
  });

  it('shows the distance to compaction past 100 % rather than clamped, beside a headline that stays a plain count (VS-129)', () => {
    const { container } = render(<ContextMeter view={view({ usage: { contextTokens: 500_000 } })} />);
    expect(screen.getByText('500k')).toBeTruthy();
    expect(screen.getByText('· 272% to compaction')).toBeTruthy();
    const bar = container.querySelector('[aria-hidden] > span');
    expect(bar?.getAttribute('style')).toContain('width: 100%');
  });
});
