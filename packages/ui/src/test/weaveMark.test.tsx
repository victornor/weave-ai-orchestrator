/** The Weave brand mark (`components/WeaveMark.tsx`) — VS-291. */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const { WeaveMark } = await import('../components/WeaveMark');

describe('WeaveMark', () => {
  it('exposes an image named by its title when it stands alone', () => {
    render(<WeaveMark title="Weave" />);
    const svg = screen.getByRole('img', { name: 'Weave' });
    expect(svg.tagName.toLowerCase()).toBe('svg');
  });

  it('is hidden from assistive technology when a wordmark already names it', () => {
    const { container } = render(<WeaveMark />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).not.toHaveAttribute('role');
    expect(svg).not.toHaveAttribute('aria-label');
  });

  it('carries the artwork at its 4.5:1 ratio and sets no width or height of its own', () => {
    const { container } = render(<WeaveMark className="h-7 w-auto" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 1860.444515 413.681337');
    expect(svg).not.toHaveAttribute('width');
    expect(svg).not.toHaveAttribute('height');
    expect(svg).toHaveClass('h-7', 'w-auto');
    expect(svg.querySelectorAll('path')).toHaveLength(4);
  });
});
