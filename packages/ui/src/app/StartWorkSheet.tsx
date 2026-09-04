import { useState } from 'react';
import { Sheet } from '../components/Sheet';
import { Composer } from '../components/Composer';
import { useCreateThread, usePostThreadMessage, useThreads } from '../api/hooks';
import { useConnection } from '../api/context';
import { enqueue } from '../lib/queue';
import { useToast } from '../components/Toast';

/**
 * Start Work: the composer, focused, with the mic. Anything said here becomes
 * a message to the conductor, which files the ticket.
 */
export function StartWorkSheet({ open, onClose }: { open: boolean; onClose: () => void }): React.ReactElement {
  const threads = useThreads();
  const createThread = useCreateThread();
  const post = usePostThreadMessage();
  const conn = useConnection();
  const toast = useToast();
  const [text, setText] = useState('');
  const offline = conn.state === 'offline' || conn.state === 'unreachable';

  const submit = async (body: string): Promise<void> => {
    const existing = threads.data?.[0]?.id;
    const threadId: string = existing ?? (await createThread.mutateAsync({})).id;
    if (offline) {
      enqueue({ kind: 'thread', path: `/threads/${threadId}/messages`, body: { body }, label: body.slice(0, 60) });
      toast.push({ title: 'Queued', detail: 'Sent as soon as the daemon is reachable.', status: 'working' });
    } else {
      await post.mutateAsync({ threadId, body });
      toast.push({ title: 'Sent to the conductor', detail: body.slice(0, 60), status: 'working', ttl: 4000 });
    }
    setText('');
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Start work">
      <Composer
        autoFocus
        rows={3}
        value={text}
        onChange={setText}
        placeholder="Tell the conductor what you need…"
        queuedReason={offline ? 'Offline — your message is queued' : null}
        onSubmit={(t) => void submit(t)}
      />
      <p className="mt-3 text-micro leading-relaxed text-text-3">
        Try “add dark mode to the dashboard in web”, or “why is ACME-42 blocked?”. The mic is push-to-talk on ⌘⇧M at a desk and tap-to-toggle on a phone.
      </p>
    </Sheet>
  );
}
