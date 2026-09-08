/** `CommitStatus` (VS-141): the visible half of a committable Settings field, one render per status. */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommitStatus } from '../components/CommitStatus';

describe('CommitStatus', () => {
  it('renders nothing when idle', () => {
    const { container } = render(<CommitStatus status="idle" onSave={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows an unsaved indicator and a Save action while dirty', () => {
    const onSave = vi.fn();
    render(<CommitStatus status="dirty" onSave={onSave} />);
    expect(screen.getByText('Unsaved')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('shows a saving indicator with no action while saving', () => {
    render(<CommitStatus status="saving" onSave={vi.fn()} />);
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows a saved confirmation with no action once saved', () => {
    render(<CommitStatus status="saved" onSave={vi.fn()} />);
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the rejection message and a Retry action on error', () => {
    const onSave = vi.fn();
    render(<CommitStatus status="error" error="branch not found" onSave={onSave} />);
    expect(screen.getByText('branch not found')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('falls back to a generic message when an error carries none', () => {
    render(<CommitStatus status="error" onSave={vi.fn()} />);
    expect(screen.getByText('Could not save')).toBeInTheDocument();
  });
});
