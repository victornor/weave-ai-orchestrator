/**
 * One V2 chat message (web-v2/chat): its body through the shared markdown renderer with ticket
 * identifiers rewritten to clickable tags, its attachments as rows, and its metadata — project,
 * time, tokens, Reply. There is no avatar: the weaver is identified by position and metadata only
 * (HANDOFF §1, §5).
 */
import { useMemo } from 'react';
import type { ThreadMessage } from '@weave-ai/shared';
import { attachmentPartsOf, attachmentToView } from '@weave-ai/render';
import { Markdown } from '../components/Markdown';
import { clock, tokens } from '../lib/format';
import { cx } from '../lib/cx';

const IDENTIFIER = /\b([A-Z][A-Z0-9]+-\d+)\b/g;

/**
 * The message body. Ticket identifiers become `#ticket:` anchors the markdown renderer keeps, and
 * `.v2-root` CSS paints them as bordered mono tags; everything else stays markdown. Clicks on those
 * anchors open the ticket instead of navigating the raw href.
 */
export function MessageBody({ body, onTicket }: { body: string; onTicket: (id: string) => void }): React.ReactElement {
  const source = useMemo(() => body.replace(IDENTIFIER, (id) => `[${id}](#ticket:${id})`), [body]);
  const onClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const a = (e.target as HTMLElement).closest('a[href^="#ticket:"]');
    if (!a) return;
    e.preventDefault();
    onTicket(decodeURIComponent(a.getAttribute('href')!.slice('#ticket:'.length)));
  };
  return (
    <div onClick={onClick}>
      <Markdown source={source} className="text-body leading-relaxed text-text-body" breaks />
    </div>
  );
}

/** A small shape naming the attachment's kind, coloured by kind (HANDOFF §5). */
function AttachmentGlyph({ kind }: { kind: 'image' | 'text' | 'other' }): React.ReactElement {
  return (
    <span
      aria-hidden
      className={cx('block size-[13px] flex-none rounded-[2px] border', kind === 'image' ? 'border-accent-link' : 'border-text-3')}
      style={kind === 'image' ? { background: 'currentColor', opacity: 0.25 } : undefined}
    />
  );
}

/**
 * A message's attachments as rows: a glyph, the filename and size byline, and the kind. An image is
 * a preview; anything else is a download link. Both point at the authenticated serving route the
 * browser's own session cookie already covers.
 */
export function AttachmentRows({ ws, threadId, parts }: { ws: string; threadId: string; parts: unknown[] }): React.ReactElement | null {
  const attachments = attachmentPartsOf(parts).map(attachmentToView);
  if (attachments.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-col gap-1.5" aria-label="Attachments">
      {attachments.map((a) => {
        const href = `/api/w/${encodeURIComponent(ws)}/threads/${encodeURIComponent(threadId)}/attachments/${a.id}`;
        if (a.kind === 'image') {
          return (
            <li key={a.id}>
              <a href={href} target="_blank" rel="noreferrer" className="flex flex-col gap-1.5 rounded-r4 border border-line-1 bg-bg-2 p-2 no-underline hover:bg-bg-3">
                <img src={href} alt={a.filename} className="max-h-48 max-w-full rounded-r4 object-contain" />
                <span className="flex items-center gap-2">
                  <AttachmentGlyph kind="image" />
                  <span className="min-w-0 flex-1 truncate text-micro text-text-1">{a.filename}</span>
                  <span className="ac-mono flex-none text-nano text-text-3">{a.sizeLabel}</span>
                  <span className="v2-tag flex-none text-text-3">image</span>
                </span>
              </a>
            </li>
          );
        }
        return (
          <li key={a.id}>
            <a href={href} download={a.filename} className="flex items-center gap-2 rounded-r4 border border-line-1 bg-bg-2 px-2 py-1.5 no-underline hover:bg-bg-3">
              <AttachmentGlyph kind={a.kind} />
              <span className="min-w-0 flex-1 truncate text-micro text-text-1">{a.filename}</span>
              <span className="ac-mono flex-none text-nano text-text-3">{a.sizeLabel}</span>
              <span className="v2-tag flex-none text-text-3">{a.kind}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export interface ChatMessageProps {
  message: ThreadMessage;
  ws: string;
  /** The turn's own tokens spent, or null when it reported none. */
  spent: number | null;
  projectName?: string | null;
  onTicket: (identifier: string) => void;
  /** Present on a weaver message: set the reply target for the next message. */
  onReply?: () => void;
}

export function ChatMessage({ message, ws, spent, projectName, onTicket, onReply }: ChatMessageProps): React.ReactElement {
  const mine = message.direction === 'inbound';
  return (
    <div className={cx('flex flex-col gap-1', mine && 'items-end')} data-chat-message={message.direction}>
      {message.replyToExcerpt ? (
        <span className={cx('max-w-[80%] border-l-2 border-line-2 pl-2 text-micro text-text-3', mine ? 'text-right' : 'w-full max-w-full')}>
          <span className="line-clamp-2 block">{message.replyToExcerpt}</span>
        </span>
      ) : null}
      <div
        className={cx(
          'min-w-0',
          mine
            ? 'max-w-[78%] rounded-r4 border border-line-2 bg-bg-2 px-3 py-2.5'
            : 'w-full rounded-r4 border border-line-1 bg-bg-1 px-3.5 py-3',
        )}
      >
        <MessageBody body={message.body} onTicket={onTicket} />
        <AttachmentRows ws={ws} threadId={message.threadId} parts={message.parts} />
      </div>
      <span className={cx('flex items-center gap-2 px-0.5', mine && 'justify-end')}>
        {message.projectId && projectName ? <span className="v2-tag text-text-3">{projectName}</span> : null}
        <span className="ac-mono text-nano text-text-4">{clock(message.createdAt)}</span>
        {spent != null ? <span className="ac-mono text-nano text-text-4">· {tokens(spent)} tok</span> : null}
        {onReply ? (
          <button type="button" aria-label="Reply to this message" onClick={onReply} className="text-nano text-text-3 hover:text-text-1">
            Reply
          </button>
        ) : null}
      </span>
    </div>
  );
}
