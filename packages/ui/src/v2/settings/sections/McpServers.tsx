/**
 * Settings → MCP servers (VS-621): the MCP servers the built-in `weave` agent may use.
 *
 * A definition never holds a secret: an `env` or `headers` value may carry a `${SECRET_NAME}`
 * reference, entered through the masked secret input and stored in the workspace secret store.
 * A stdio server is arbitrary code the human chose to run on the host, and the copy says so.
 */
import { useEffect, useState } from 'react';
import { useClearMcpSecret, useDeleteMcpServer, useMcpServers, useSaveMcpServer, useSetMcpSecret, useTestMcpServer } from '../../../api/hooks';
import type * as T from '../../../api/types';
import { Button } from '../../../components/Button';
import { SkeletonRows } from '../../../components/Skeleton';
import { cx } from '../../../lib/cx';

const inputCx = 'h-8 w-full rounded-r4 border border-line-2 bg-bg-input px-2 text-micro text-text-1 outline-none';

const SECRET_REF = /\$\{([A-Za-z_][A-Za-z0-9_]{0,63})\}/g;
/** Every `${NAME}` a definition references, across its `env` and `headers`. */
function refsOf(cfg: Partial<T.McpServer>): string[] {
  const out = new Set<string>();
  for (const v of [...Object.values(cfg.env ?? {}), ...Object.values(cfg.headers ?? {})]) for (const m of v.matchAll(SECRET_REF)) out.add(m[1]!);
  return [...out];
}
function linesToRecord(text: string, sep: '=' | ':'): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const at = trimmed.indexOf(sep);
    if (at <= 0) continue;
    out[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1).trim();
  }
  return out;
}
function recordToLines(record: Record<string, string> | undefined, sep: '=' | ':'): string {
  return Object.entries(record ?? {}).map(([k, v]) => `${k}${sep === ':' ? ': ' : '='}${v}`).join('\n');
}

interface Draft {
  name: string; type: 'http' | 'stdio'; url: string; command: string; argsText: string;
  envText: string; headersText: string; listTimeoutMs: string; callTimeoutMs: string; readOnly: boolean;
}
function draftOf(name: string, c: T.McpServer | null): Draft {
  return {
    name,
    type: c?.type ?? 'stdio',
    url: c?.url ?? '',
    command: c?.command ?? '',
    argsText: (c?.args ?? []).join('\n'),
    envText: recordToLines(c?.env, '='),
    headersText: recordToLines(c?.headers, ':'),
    listTimeoutMs: c ? String(c.listTimeoutMs) : '30000',
    callTimeoutMs: c ? String(c.callTimeoutMs) : '60000',
    readOnly: c?.readOnly ?? false,
  };
}
function configOf(d: Draft): T.McpServer {
  const env = linesToRecord(d.envText, '=');
  const headers = linesToRecord(d.headersText, ':');
  return {
    type: d.type,
    ...(d.type === 'http' ? { url: d.url.trim() } : {}),
    ...(d.type === 'stdio' ? { command: d.command.trim() } : {}),
    args: d.type === 'stdio' ? d.argsText.split('\n').map((s) => s.trim()).filter(Boolean) : [],
    env, headers,
    listTimeoutMs: Number(d.listTimeoutMs) || 30_000,
    callTimeoutMs: Number(d.callTimeoutMs) || 60_000,
    readOnly: d.readOnly,
  };
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <label className="flex flex-col gap-1">
      <span className="ac-label">{label}</span>
      {children}
      {hint ? <span className="text-nano text-text-3">{hint}</span> : null}
    </label>
  );
}

/** The masked input for one referenced secret; a stored value is never read back into the field. */
function SecretRow({ name, configured, pending, onSet, onClear }: {
  name: string; configured: boolean; pending: boolean; onSet: (value: string) => void; onClear: () => void;
}): React.ReactElement {
  const [draft, setDraft] = useState('');
  return (
    <div className="v2-recessed flex flex-col gap-1 rounded-r4 border border-line-1 px-3 py-2">
      <div className="flex items-baseline gap-2">
        <span className="ac-label">secret</span>
        <span className="ac-mono min-w-0 flex-1 truncate text-micro text-text-3">{name}</span>
        <span className={cx('v2-tag', configured ? 'text-text-2' : 'text-text-3')}>{configured ? 'set' : 'not set'}</span>
      </div>
      <div className="flex gap-2">
        <input type="password" aria-label={`${name} value`} autoComplete="off" className={cx(inputCx, 'ac-mono')}
          placeholder={configured ? 'Replace the value…' : 'Paste the value…'} value={draft} onChange={(e) => setDraft(e.target.value)} />
        <Button size="sm" variant="primary" disabled={!draft || pending} onClick={() => { onSet(draft); setDraft(''); }}>Save</Button>
        <Button size="sm" variant="danger" disabled={!configured || pending} onClick={onClear}>Clear</Button>
      </div>
    </div>
  );
}

function ServerRow({ view, onSave, onRemove }: { view: T.McpServerView; onSave: (config: T.McpServer) => Promise<void>; onRemove: () => void }): React.ReactElement {
  const { name, config, secrets } = view;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(name, config));
  const [report, setReport] = useState<T.McpTestReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const test = useTestMcpServer();
  const setSecret = useSetMcpSecret();
  const clearSecret = useClearMcpSecret();
  useEffect(() => { setDraft(draftOf(name, config)); }, [name, config]);

  const save = (): void => {
    const built = configOf(draft);
    if (built.type === 'stdio' && !built.command) { setError('A stdio server needs a command.'); return; }
    if (built.type === 'http' && !built.url) { setError('An HTTP server needs a URL.'); return; }
    setError(null);
    void onSave(built);
  };
  const refs = refsOf(config);

  return (
    <div className="v2-card flex flex-col">
      <div className="flex items-baseline gap-2 px-3 py-2">
        <button type="button" className="flex min-w-0 flex-1 items-baseline gap-2 text-left" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <span className="ac-mono text-meta text-text-1">{name}</span>
          <span className="v2-tag text-text-2">{config.type}</span>
          <span className="truncate text-micro text-text-3">{config.type === 'http' ? config.url : config.command}</span>
          <span className="text-nano text-text-3">{secrets.filter((s) => s.configured).length}/{secrets.length} secret{secrets.length === 1 ? '' : 's'}</span>
          <span className="ml-auto text-text-3" aria-hidden>{open ? '▾' : '▸'}</span>
        </button>
      </div>
      {open ? (
        <div className="v2-anim-fade flex flex-col gap-3 border-t border-line-1 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="type">
              <select aria-label={`${name} type`} className={cx(inputCx, 'ac-mono')} value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as Draft['type'] })}>
                <option value="stdio">stdio</option>
                <option value="http">http</option>
              </select>
            </Field>
            {draft.type === 'http' ? (
              <Field label="url">
                <input aria-label={`${name} url`} className={cx(inputCx, 'ac-mono')} value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
              </Field>
            ) : (
              <Field label="command">
                <input aria-label={`${name} command`} className={cx(inputCx, 'ac-mono')} value={draft.command} onChange={(e) => setDraft({ ...draft, command: e.target.value })} />
              </Field>
            )}
            {draft.type === 'stdio' ? (
              <Field label="args" hint="One argument per line.">
                <textarea aria-label={`${name} args`} className={cx(inputCx, 'ac-mono h-16 py-1.5')} value={draft.argsText} onChange={(e) => setDraft({ ...draft, argsText: e.target.value })} />
              </Field>
            ) : (
              <Field label="headers" hint="One Name: value per line. A value may carry ${SECRET_NAME}.">
                <textarea aria-label={`${name} headers`} className={cx(inputCx, 'ac-mono h-16 py-1.5')} value={draft.headersText} onChange={(e) => setDraft({ ...draft, headersText: e.target.value })} />
              </Field>
            )}
            <Field label="env" hint="One NAME=value per line. A value may carry ${SECRET_NAME}; never paste a secret here.">
              <textarea aria-label={`${name} env`} className={cx(inputCx, 'ac-mono h-16 py-1.5')} value={draft.envText} onChange={(e) => setDraft({ ...draft, envText: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="list timeout ms">
                <input aria-label={`${name} list timeout`} type="number" min={1} className={cx(inputCx, 'ac-mono')} value={draft.listTimeoutMs} onChange={(e) => setDraft({ ...draft, listTimeoutMs: e.target.value })} />
              </Field>
              <Field label="call timeout ms">
                <input aria-label={`${name} call timeout`} type="number" min={1} className={cx(inputCx, 'ac-mono')} value={draft.callTimeoutMs} onChange={(e) => setDraft({ ...draft, callTimeoutMs: e.target.value })} />
              </Field>
            </div>
          </div>
          <label className="flex items-center gap-2 text-micro text-text-2">
            <input type="checkbox" aria-label={`${name} read only`} checked={draft.readOnly} onChange={(e) => setDraft({ ...draft, readOnly: e.target.checked })} />
            Read-only server (kept in <span className="ac-mono">restricted</span> runs; a declaration, not enforcement)
          </label>
          {refs.map((ref) => {
            const configured = secrets.find((s) => s.name === ref)?.configured ?? false;
            return (
              <SecretRow key={ref} name={ref} configured={configured} pending={setSecret.isPending || clearSecret.isPending}
                onSet={(value) => setSecret.mutate({ name: ref, value })} onClear={() => clearSecret.mutate(ref)} />
            );
          })}
          {error ? <span role="alert" className="text-micro text-failed">{error}</span> : null}
          {test.isError ? <span role="alert" className="text-micro text-failed">{test.error.message}</span> : null}
          {report ? (
            <div className="v2-recessed flex flex-col gap-1 rounded-r4 border border-line-1 px-3 py-2">
              {report.ok
                ? report.tools.map((t) => <div key={t.name} className="flex items-baseline gap-2"><span className="ac-mono text-nano text-text-2">{t.name}</span><span className="min-w-0 flex-1 truncate text-micro text-text-3">{t.description}</span></div>)
                : <span role="alert" className="text-micro text-failed">{report.error ?? 'The server could not be reached.'}</span>}
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button size="sm" disabled={test.isPending} onClick={() => test.mutate(name, { onSuccess: (r) => setReport(r) })}>{test.isPending ? 'Testing…' : 'Test'}</Button>
            <Button size="sm" variant="primary" onClick={save}>Save</Button>
            {confirmRemove ? (
              <>
                <Button size="sm" variant="danger" onClick={onRemove}>Confirm remove</Button>
                <Button size="sm" onClick={() => setConfirmRemove(false)}>Cancel</Button>
              </>
            ) : <Button size="sm" variant="danger" onClick={() => setConfirmRemove(true)}>Remove</Button>}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AddServer({ onAdd, onCancel }: { onAdd: (name: string, config: T.McpServer) => void; onCancel: () => void }): React.ReactElement {
  const [name, setName] = useState('');
  const [type, setType] = useState<'stdio' | 'http'>('stdio');
  const [target, setTarget] = useState('');
  const valid = /^[a-z0-9][a-z0-9_-]*$/.test(name.trim()) && name.trim() !== 'weave-ai' && target.trim().length > 0;
  const add = (): void => {
    const base: T.McpServer = { type, env: {}, headers: {}, args: [], listTimeoutMs: 30_000, callTimeoutMs: 60_000, readOnly: false };
    onAdd(name.trim(), type === 'http' ? { ...base, url: target.trim() } : { ...base, command: target.trim() });
  };
  return (
    <div className="v2-card flex flex-col gap-3 p-3">
      <span className="ac-label">Add a server</span>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="name" hint="Lower-case kebab-case; the mcpServers: key. weave-ai is reserved.">
          <input aria-label="New MCP server name" className={cx(inputCx, 'ac-mono')} value={name} placeholder="github" onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="type">
          <select aria-label="New MCP server type" className={cx(inputCx, 'ac-mono')} value={type} onChange={(e) => setType(e.target.value as 'stdio' | 'http')}>
            <option value="stdio">stdio</option>
            <option value="http">http</option>
          </select>
        </Field>
        <Field label={type === 'http' ? 'url' : 'command'}>
          <input aria-label="New MCP server target" className={cx(inputCx, 'ac-mono')} value={target} placeholder={type === 'http' ? 'https://…/mcp' : 'npx'} onChange={(e) => setTarget(e.target.value)} />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={!valid} onClick={add}>Add server</Button>
      </div>
    </div>
  );
}

export function McpServersSection(): React.ReactElement {
  const servers = useMcpServers();
  const save = useSaveMcpServer();
  const remove = useDeleteMcpServer();
  const [adding, setAdding] = useState(false);
  if (servers.isLoading) return <SkeletonRows rows={3} />;
  if (servers.isError) return <p className="text-micro text-text-3">The workspace's MCP servers could not be read: {servers.error.message}</p>;
  const list = servers.data?.servers ?? [];
  return (
    <div className="flex flex-col gap-3">
      <p className="text-micro leading-relaxed text-text-3">
        MCP servers for the built-in <span className="ac-mono">weave</span> runtime. A <span className="ac-mono">stdio</span> server
        is arbitrary code you chose to run on the host, launched with a minimal environment. Secrets are referenced as
        <span className="ac-mono"> {'${SECRET_NAME}'}</span>, stored in the workspace secret store, and never written to this config.
        Only Claude, OpenCode and Codex keep their own MCP config; these servers are Weave AI's own.
      </p>
      <div className="flex items-baseline gap-2">
        <span className="ac-label text-text-1">MCP servers</span>
        <div className="flex-1" />
        <button type="button" className="v2-link text-micro" onClick={() => setAdding((v) => !v)}>+ Add a server</button>
      </div>
      {list.length === 0 && !adding ? <p className="text-micro text-text-3">None configured.</p> : null}
      {list.map((s) => (
        <ServerRow key={s.name} view={s}
          onSave={async (config) => { await save.mutateAsync({ name: s.name, config: { ...config, readOnly: config.readOnly } }); }}
          onRemove={() => remove.mutate(s.name)} />
      ))}
      {adding ? (
        <AddServer onCancel={() => setAdding(false)} onAdd={(name, config) => void save.mutateAsync({ name, config }).then(() => setAdding(false))} />
      ) : null}
      {save.isError ? <span role="alert" className="text-micro text-failed">{save.error.message}</span> : null}
    </div>
  );
}
