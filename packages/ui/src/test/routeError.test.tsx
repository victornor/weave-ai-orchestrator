import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteError } from '../components/RouteError';

const reload = vi.fn();
beforeEach(() => {
  reload.mockClear();
  vi.stubGlobal('location', { ...window.location, reload });
});

describe('RouteError', () => {
  it('shows the existing generic error state for a real error, and does not reload', () => {
    render(<RouteError error={new Error('boom')} reset={() => undefined} />);
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads once, without showing the generic error, on a fresh dynamic-import failure', () => {
    render(<RouteError error={new Error('Failed to fetch dynamically imported module: /assets/Foo-abc.js')} reset={() => undefined} />);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not reload again for a second failure inside the guard window, and says so', () => {
    const error = new Error('Failed to fetch dynamically imported module: /assets/Foo-abc.js');
    render(<RouteError error={error} reset={() => undefined} />);
    expect(reload).toHaveBeenCalledTimes(1);

    render(<RouteError error={error} reset={() => undefined} />);
    expect(reload).toHaveBeenCalledTimes(1); // still just the one from the first render
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });
});
