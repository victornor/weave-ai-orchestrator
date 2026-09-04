import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { UI_STATUSES } from '@agent-conductor/shared';
import { StatusGlyph, StatusBadge } from '../components/StatusGlyph';
import { TicketCard } from '../components/TicketCard';
import { WorkerCard } from '../components/WorkerCard';
import { DecisionCard } from '../components/DecisionCard';
import { Composer } from '../components/Composer';
import { BudgetMeter } from '../components/BudgetMeter';
import { TOTPInput } from '../components/TOTPInput';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { EmptyState, ErrorState } from '../components/States';
import { ApiError } from '../api/client';
import { agent, decision, ticket } from './factories';

describe('StatusGlyph', () => {
  it('renders one accessible glyph per status token', () => {
    for (const s of UI_STATUSES) {
      const { unmount } = render(<StatusGlyph status={s} />);
      expect(screen.getByRole('img')).toHaveAccessibleName(s === 'needs-you' ? 'needs you' : s);
      unmount();
    }
  });

  it('labels the badge', () => {
    render(<StatusBadge status="working" />);
    expect(screen.getByText('working')).toBeInTheDocument();
  });
});

describe('TicketCard', () => {
  it('shows the identifier, title and kind', () => {
    render(<TicketCard ticket={ticket()} />);
    expect(screen.getByText('ACME-42')).toBeInTheDocument();
    expect(screen.getByText('Dark mode for the dashboard')).toBeInTheDocument();
    expect(screen.getByText('change')).toBeInTheDocument();
  });

  it('prints the exact status when the card was folded into a neighbouring column', () => {
    render(<TicketCard ticket={ticket({ status: 'merging' })} />);
    expect(screen.getByText('merging')).toBeInTheDocument();
  });

  it('does not print a sub-status for a status that owns its column', () => {
    render(<TicketCard ticket={ticket({ status: 'in_progress' })} />);
    expect(screen.queryByText('in progress')).not.toBeInTheDocument();
  });
});

describe('WorkerCard', () => {
  it('shows the last line and the worktree state', () => {
    render(
      <WorkerCard
        agent={agent()}
        projectSlug="web"
        ticketIdentifier="ACME-42"
        lastLine="running vitest — 38/41 passed"
        worktree={{ status: 'active', dirty: true, ahead: 3, behind: 0 }}
        usage={{ tokens: 18400, costCents: 41, estimated: true }}
      />,
    );
    expect(screen.getByText('Frontend Engineer #7')).toBeInTheDocument();
    expect(screen.getByText('running vitest — 38/41 passed')).toBeInTheDocument();
    expect(screen.getByText('↑3 ↓0')).toBeInTheDocument();
    expect(screen.getByText('18.4k tok')).toBeInTheDocument();
    expect(screen.getByText('$0.41 est')).toBeInTheDocument();
  });
});

describe('DecisionCard', () => {
  it('renders the plan variant with Approve / Revise / reject', () => {
    render(<DecisionCard decision={decision()} ticketIdentifier="ACME-42" onAnswer={() => undefined} />);
    expect(screen.getByText('Needs you')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Revise/ })).toBeInTheDocument();
    expect(screen.getByText('ThemeProvider + OS fallback')).toBeInTheDocument();
  });

  it('answers with the approve key', () => {
    const onAnswer = vi.fn();
    render(<DecisionCard decision={decision()} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }));
    expect(onAnswer).toHaveBeenCalledWith({ key: 'approve' });
  });

  it('marks the recommended option PICKED on a worker question', () => {
    render(
      <DecisionCard
        decision={decision({
          kind: 'question',
          options: [
            { key: 'local', label: 'localStorage + system fallback', description: 'No backend change.', recommended: true },
            { key: 'user', label: 'Persist on the user record', description: 'Needs a migration.' },
          ],
        })}
        onAnswer={() => undefined}
      />,
    );
    expect(screen.getByText('PICKED')).toBeInTheDocument();
    expect(screen.getByText('Something else…')).toBeInTheDocument();
  });

  it('keeps the destructive variant disabled until the identifier is typed', () => {
    render(<DecisionCard decision={decision({ kind: 'discard_approval' })} ticketIdentifier="ACME-42" onAnswer={() => undefined} />);
    const discard = screen.getByRole('button', { name: 'Discard' });
    expect(discard).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Type the ticket identifier to confirm'), { target: { value: 'ACME-42' } });
    expect(discard).toBeEnabled();
  });
});

describe('Composer', () => {
  it('submits on Enter and clears', () => {
    const onSubmit = vi.fn();
    render(<Composer onSubmit={onSubmit} placeholder="Message the conductor…" />);
    const box = screen.getByLabelText('Message the conductor…');
    fireEvent.change(box, { target: { value: 'add dark mode' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('add dark mode');
  });

  it('explains the queued state when the conductor is mid-turn', () => {
    render(<Composer onSubmit={() => undefined} queuedReason="Conductor is replying — your message is queued" queuedCount={1} />);
    expect(screen.getByText('Conductor is replying — your message is queued')).toBeInTheDocument();
    expect(screen.getByText('1 queued')).toBeInTheDocument();
  });

  it('keeps the mic visible and dimmed when dictation is unavailable', () => {
    render(<Composer onSubmit={() => undefined} />);
    const mic = screen.getByLabelText('Dictation unavailable');
    fireEvent.click(mic);
    expect(screen.getByText(/Dictation is unavailable/)).toBeInTheDocument();
  });
});

describe('BudgetMeter', () => {
  it('turns amber at curation due', () => {
    render(<BudgetMeter label="web · project KB" used={11400} budget={12000} curationPending />);
    expect(screen.getByText('curation due')).toBeInTheDocument();
    expect(screen.getByText('11.4k / 12.0k tok')).toBeInTheDocument();
  });
});

describe('TOTPInput', () => {
  it('fills all six boxes from a paste', () => {
    let value = '';
    const onChange = vi.fn((v: string) => {
      value = v;
    });
    render(<TOTPInput value="" onChange={onChange} />);
    fireEvent.paste(screen.getByLabelText('Digit 1'), { clipboardData: { getData: () => '407219' } });
    expect(onChange).toHaveBeenCalledWith('407219');
    expect(value).toBe('407219');
  });
});

describe('ConnectionBanner', () => {
  it('shows nothing when connected', () => {
    const { container } = render(<ConnectionBanner state="connected" capturedAt={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names the capture time when offline', () => {
    render(<ConnectionBanner state="offline" capturedAt="2026-09-01T09:38:00.000Z" queuedCount={2} />);
    expect(screen.getByText(/Offline — showing the state from/)).toBeInTheDocument();
    expect(screen.getByText('2 queued')).toBeInTheDocument();
  });
});

describe('states', () => {
  it('empty state is one sentence plus what is true instead', () => {
    render(<EmptyState title="Nothing needs you right now." detail="3 workers running." />);
    expect(screen.getByText('Nothing needs you right now.')).toBeInTheDocument();
    expect(screen.getByText('3 workers running.')).toBeInTheDocument();
  });

  it('error state shows the typed code and a next step', () => {
    render(<ErrorState error={new ApiError(503, { code: 'runtime_unreachable', message: 'The claude-code runtime did not answer in 30s.' })} onRetry={() => undefined} />);
    expect(screen.getByText('RUNTIME_UNREACHABLE')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
