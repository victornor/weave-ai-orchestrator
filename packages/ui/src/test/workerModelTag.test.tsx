/** VS-217: the worker model tier tag and its derived visibility gate. */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { WorkerModelOption } from '@agent-conductor/shared';
import { workerModelTagLabel, WorkerModelTag } from '../components/WorkerModelTag';

const opt = (id: string): WorkerModelOption => ({ id, description: `${id} tier`, runtime: 'claude', model: null });
const deep = { workerModelId: 'deep' };

describe('workerModelTagLabel', () => {
  it('is hidden with zero or one configured option — the gate is derived from the catalog', () => {
    expect(workerModelTagLabel(deep, [])).toBeNull();
    expect(workerModelTagLabel(deep, undefined)).toBeNull();
    expect(workerModelTagLabel(deep, [opt('deep')])).toBeNull();
  });

  it('shows the ticket\'s option id when it is in a catalog of several', () => {
    expect(workerModelTagLabel(deep, [opt('quick'), opt('standard'), opt('deep')])).toBe('deep');
  });

  it('labels a ticket with no option id as default, so absence is never ambiguous', () => {
    expect(workerModelTagLabel({ workerModelId: null }, [opt('quick'), opt('standard')])).toBe('default');
  });

  it('labels a dangling id as default — the setting its next turn resolves to', () => {
    expect(workerModelTagLabel(deep, [opt('quick'), opt('standard')])).toBe('default');
  });

  it('flips visibility with the configured count, not a hardcoded list', () => {
    const same = [opt('quick'), opt('deep')];
    expect(workerModelTagLabel(deep, same.slice(0, 1))).toBeNull();
    expect(workerModelTagLabel(deep, same)).toBe('deep');
  });
});

describe('WorkerModelTag', () => {
  it('renders the label as a badge', () => {
    render(<WorkerModelTag ticket={deep} options={[opt('quick'), opt('deep')]} />);
    expect(screen.getByText('deep')).toBeInTheDocument();
  });

  it('renders nothing while the tag is gated off', () => {
    const { container } = render(<WorkerModelTag ticket={deep} options={[opt('deep')]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
