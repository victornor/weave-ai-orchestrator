/**
 * VS-623: ticket identifiers link in every agent-text surface, and code stays literal.
 *
 * `Transcript` (settled session turns, the worker live view, run pages), `LivePartials` (streaming
 * text) and `Markdown` (which all of them render through) share the one linkifier, so these tests
 * pin the surface behavior: an identifier in prose and thinking is a tag that calls `onTicket`, an
 * identifier in streamed text is a tag, and an identifier inside a code span or fence is not.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RunEvent } from '@weave-ai/shared';
import { Transcript } from '../components/Transcript';
import { LivePartials } from '../components/LiveActivity';
import { Markdown } from '../components/Markdown';
import { ChatTrace } from '../v2/ChatTrace';
import { MessageBody } from '../v2/ChatMessage';

let seq = 0;
const ev = (type: RunEvent['type'], payload: Record<string, unknown>): RunEvent => ({
  id: `e${(seq += 1)}`,
  runId: 'r1',
  seq,
  ts: '2026-09-20T00:00:00.000Z',
  stream: 'stdout',
  level: 'info',
  type,
  payload,
});

describe('ticket identifiers on agent-text surfaces (VS-623)', () => {
  it('links an identifier in settled transcript prose and opens the ticket', () => {
    const onTicket = vi.fn();
    render(<Transcript events={[ev('assistant.text', { text: 'I filed VS-623 (change, critical).' })]} onTicket={onTicket} />);
    const tag = screen.getByText('VS-623');
    expect(tag.tagName).toBe('A');
    expect(tag.getAttribute('href')).toBe('#ticket:VS-623');
    fireEvent.click(tag);
    expect(onTicket).toHaveBeenCalledWith('VS-623');
  });

  it('links an identifier in a thinking block', () => {
    const onTicket = vi.fn();
    render(<Transcript events={[ev('assistant.thinking', { text: 'relates to VS-1' })]} onTicket={onTicket} />);
    fireEvent.click(screen.getByRole('button', { name: /Thought/ }));
    fireEvent.click(screen.getByText('VS-1'));
    expect(onTicket).toHaveBeenCalledWith('VS-1');
  });

  it('links an identifier in streamed partial text', () => {
    const onTicket = vi.fn();
    render(<LivePartials partials={[{ partId: 'p1', kind: 'text', text: 'filed ACME-42' }]} onTicket={onTicket} />);
    fireEvent.click(screen.getByText('ACME-42'));
    expect(onTicket).toHaveBeenCalledWith('ACME-42');
  });

  it('links an identifier in a chat trace narration', () => {
    const onTicket = vi.fn();
    render(<ChatTrace events={[ev('assistant.text', { text: 'filed VS-7 while checking' })]} onTicket={onTicket} />);
    fireEvent.click(screen.getByText('VS-7'));
    expect(onTicket).toHaveBeenCalledWith('VS-7');
  });

  it('links an identifier in a message body and leaves a code span literal', () => {
    const onTicket = vi.fn();
    render(<MessageBody body={'See VS-623 but `VS-999` is literal.'} onTicket={onTicket} />);
    expect(screen.getByText('VS-623').tagName).toBe('A');
    expect(screen.getByText('VS-999').tagName).toBe('CODE');
    fireEvent.click(screen.getByText('VS-623'));
    expect(onTicket).toHaveBeenCalledWith('VS-623');
  });

  it('leaves identifiers inside a code span and a fenced block literal', () => {
    const onTicket = vi.fn();
    render(<Markdown onTicket={onTicket} source={'prose VS-1\n\n`code VS-2`\n\n```\nblock VS-3\n```'} />);
    expect(screen.getByText('VS-1').tagName).toBe('A');
    expect(screen.getByText(/VS-2/).tagName).toBe('CODE');
    expect(screen.getByText(/VS-3/).tagName).toBe('CODE');
    expect(onTicket).not.toHaveBeenCalled();
  });
});
