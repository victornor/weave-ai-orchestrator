/** VS-601: a running command's output so far shows under the live activity row. */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { LivePartials } from './LiveActivity';

describe('LivePartials', () => {
  it('shows the last lines of a running tool\'s output', () => {
    const { container } = render(<LivePartials partials={[{ partId: 'c1:out', kind: 'tool_input', text: 'a\nb\nc\nd\ne\nf\n' }]} />);
    expect(container.querySelector('[data-live-tool-output]')?.textContent).toBe('c\nd\ne\nf');
  });

  it('renders nothing when no partial has text', () => {
    const { container } = render(<LivePartials partials={[{ partId: 'c1:out', kind: 'tool_input', text: '' }]} />);
    expect(container.querySelector('[data-live-partials]')).toBeNull();
  });
});
