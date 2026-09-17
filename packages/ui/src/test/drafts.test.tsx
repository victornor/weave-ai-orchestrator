import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { Composer } from '../components/Composer';
import { draftKey, readDraft, seedDraft, takeSeededDraft, useDraft, writeDraft } from '../lib/drafts';

/** A composer bound to one conversation's draft, the way the routes bind it. */
function Box({ ws, thread }: { ws: string; thread: string }): React.ReactElement {
  const { draft, patch } = useDraft(draftKey(ws, thread));
  return (
    <Composer
      placeholder="Message…"
      value={draft.text}
      onChange={(text) => patch({ text })}
      onSubmit={() => undefined}
    />
  );
}

const box = (): HTMLTextAreaElement => screen.getByLabelText('Message…') as HTMLTextAreaElement;
const stored = (ws: string, thread: string): string | null => sessionStorage.getItem(draftKey(ws, thread));

beforeEach(() => sessionStorage.clear());

describe('drafts', () => {
  it('keys a draft by workspace and conversation', () => {
    expect(draftKey('acme', 'thread:th_1')).not.toBe(draftKey('other', 'thread:th_1'));
    expect(draftKey('acme', 'thread:th_1')).not.toBe(draftKey('acme', 'ticket:tk_1'));
  });

  it('reads nothing back for an unknown key, a null key, or a half-written entry', () => {
    expect(readDraft(null)).toEqual({ text: '' });
    expect(readDraft(draftKey('acme', 'thread:th_1'))).toEqual({ text: '' });
    sessionStorage.setItem(draftKey('acme', 'thread:th_1'), '{not json');
    expect(readDraft(draftKey('acme', 'thread:th_1'))).toEqual({ text: '' });
  });

  it('removes the entry rather than storing an empty draft', () => {
    writeDraft(draftKey('acme', 'thread:th_1'), { text: 'something' });
    expect(stored('acme', 'thread:th_1')).not.toBeNull();
    writeDraft(draftKey('acme', 'thread:th_1'), { text: '' });
    expect(stored('acme', 'thread:th_1')).toBeNull();
  });

  it('persists what is typed, and restores it on a fresh mount', () => {
    const first = render(<Box ws="acme" thread="thread:th_1" />);
    fireEvent.change(box(), { target: { value: 'a half-written note' } });
    expect(readDraft(draftKey('acme', 'thread:th_1')).text).toBe('a half-written note');
    first.unmount();

    render(<Box ws="acme" thread="thread:th_1" />);
    expect(box().value).toBe('a half-written note');
  });

  it('swaps the draft when the conversation changes, without carrying one over', () => {
    const view = render(<Box ws="acme" thread="thread:th_1" />);
    fireEvent.change(box(), { target: { value: 'for the first thread' } });

    view.rerender(<Box ws="acme" thread="thread:th_2" />);
    expect(box().value).toBe('');
    fireEvent.change(box(), { target: { value: 'for the second' } });

    view.rerender(<Box ws="acme" thread="thread:th_1" />);
    expect(box().value).toBe('for the first thread');
    expect(readDraft(draftKey('acme', 'thread:th_2')).text).toBe('for the second');
  });

  it('keeps the same conversation apart in two workspaces', () => {
    const first = render(<Box ws="acme" thread="ticket:tk_1" />);
    fireEvent.change(box(), { target: { value: 'in acme' } });
    first.unmount();

    render(<Box ws="other" thread="ticket:tk_1" />);
    expect(box().value).toBe('');
    expect(readDraft(draftKey('acme', 'ticket:tk_1')).text).toBe('in acme');
  });

  it('round-trips a chosen roadmap block and clears it with the rest (VS-491)', () => {
    writeDraft(draftKey('acme', 'thread:th_1'), { text: '', projectId: 'p1', blockId: 'b1' });
    expect(readDraft(draftKey('acme', 'thread:th_1'))).toMatchObject({ projectId: 'p1', blockId: 'b1' });
    // A block-only choice is still a draft worth keeping.
    expect(stored('acme', 'thread:th_1')).not.toBeNull();
    writeDraft(draftKey('acme', 'thread:th_1'), { text: '' });
    expect(stored('acme', 'thread:th_1')).toBeNull();
  });
});

describe('seeded prompts (VS-478)', () => {
  it('is consumed once and never crosses workspaces', () => {
    seedDraft('acme', 'Tell me about roadmaps');
    expect(takeSeededDraft('other')).toBeNull();
    expect(takeSeededDraft('acme')).toBe('Tell me about roadmaps');
    expect(takeSeededDraft('acme')).toBeNull();
  });

  it('places the seed in the thread draft and leaves an existing draft alone', () => {
    seedDraft('acme', 'Tell me about roadmaps');
    writeDraft(draftKey('acme', 'thread:th_1'), { text: 'already typing' });
    // The chat only consumes the seed into an empty composer, so the human's words survive.
    expect(readDraft(draftKey('acme', 'thread:th_1')).text).toBe('already typing');
    expect(takeSeededDraft('acme')).toBe('Tell me about roadmaps');
  });
});
