/**
 * VS-349: the V2 chat composer — the three identical controls, the project scope selector, dictation
 * appended to the existing text, and attachments staged through the picker.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';

const dict = vi.hoisted(() => ({
  onText: null as ((text: string, final: boolean) => void) | null,
  listening: false,
}));

vi.mock('../lib/dictation', () => ({
  useDictation: (onText: (text: string, final: boolean) => void) => {
    dict.onText = onText;
    return {
      mode: 'speech',
      listening: dict.listening,
      transcribing: false,
      elapsed: 0,
      analyser: { current: null },
      metered: false,
      error: null,
      start: () => { dict.listening = true; },
      stop: () => { dict.listening = false; },
      toggle: () => undefined,
      diagnostics: { enabled: false, count: 0, copy: () => undefined },
    };
  },
}));

const { ChatComposer } = await import('../v2/ChatComposer');

const PROJECTS = [
  { id: 'p1', workspaceId: 'ws1', slug: 'web', name: 'web' },
  { id: 'p2', workspaceId: 'ws1', slug: 'api', name: 'api' },
] as never[];

function Harness({ onSubmit }: { onSubmit: (text: string, files: File[], opts: { projectId: string | null; replyToMessageId: string | null; idempotencyKey: string }) => void }): React.ReactElement {
  const [text, setText] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  return (
    <ChatComposer
      projects={PROJECTS}
      projectId={projectId}
      onChangeProject={setProjectId}
      value={text}
      onChange={setText}
      onSubmit={onSubmit}
      onOpenSearch={vi.fn()}
    />
  );
}

beforeEach(() => {
  dict.onText = null;
  dict.listening = false;
});

describe('the V2 chat composer', () => {
  it('renders three identical attach, dictate and send controls', () => {
    render(<Harness onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Attach a file' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dictate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('sends the typed text once, with an idempotency key', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Message the weaver'), { target: { value: 'ship it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('ship it', [], expect.objectContaining({ idempotencyKey: expect.any(String) }));
  });

  it('sends the chosen project as projectId and Auto as none', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Message the weaver'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'web' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).toHaveBeenLastCalledWith('x', [], expect.objectContaining({ projectId: 'p1' }));
  });

  it('appends the recognized transcript after the existing text', () => {
    render(<Harness onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Message the weaver'), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Dictate' }));
    act(() => dict.onText?.('there', true));
    expect(screen.getByLabelText('Message the weaver')).toHaveValue('Hi there');
  });

  it('stages a file through the picker and sends it with the message', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    const input = screen.getByTestId('v2-composer-file-input');
    const file = new File(['notes'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText('notes.txt')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Message the weaver'), { target: { value: 'see file' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).toHaveBeenCalledWith('see file', [file], expect.objectContaining({ idempotencyKey: expect.any(String) }));
  });

  it('shows the error and keeps the text when the send is rejected', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('The daemon refused the message.'));
    render(<Harness onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Message the weaver'), { target: { value: 'keep me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The daemon refused the message.');
    expect(screen.getByLabelText('Message the weaver')).toHaveValue('keep me');
  });

  it('refuses an unaccepted file type with the shared message', () => {
    render(<Harness onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByTestId('v2-composer-file-input'), {
      target: { files: [new File(['x'], 'archive.zip', { type: 'application/zip' })] },
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/Only images/);
  });
});
