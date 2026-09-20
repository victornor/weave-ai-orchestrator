/**
 * Saves an attachment by fetching its bytes and handing the browser a blob (VS-597). A bare
 * `<a download>` to the daemon's URL leaves the transfer to the phone's download manager, which can
 * fail after it starts ("Check internet connection") with nothing for the page to show; this way the
 * page owns the request, so a failure is an error it can display and retry.
 */
import { useCallback, useState } from 'react';

export async function saveAttachment(url: string, name: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'include' });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  if (!res.ok) throw new Error(`The download failed (HTTP ${res.status}).`);
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked late: some mobile browsers start reading the blob after the click returns.
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

export interface AttachmentDownload {
  busy: boolean;
  error: string | null;
  start: () => Promise<void>;
}

export function useAttachmentDownload(url: string, name: string): AttachmentDownload {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await saveAttachment(url, name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The download failed.');
    } finally {
      setBusy(false);
    }
  }, [url, name]);
  return { busy, error, start };
}
