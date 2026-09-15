/**
 * The workspace Settings sections that are new or read-only (VS-348): the Weaver descriptions, the
 * Approvals defaults, and Knowledge (real budgets plus the read-only curation description).
 */
import { APPROVAL_OWNERS, DELIVERY_MODES, WorkspaceDefaultsSchema } from '@weave-ai/shared';
import { usePatchConfig, useWorkspaceSummary } from '../../../api/hooks';
import type * as T from '../../../api/types';
import { CommitStatus } from '../../../components/CommitStatus';
import { KnowledgeBudgetsSection } from '../../../settings/sections';
import { useCommittableField } from '../../../lib/commit-field';
import { cx } from '../../../lib/cx';

function DescRow({ title, detail, tag }: { title: string; detail: string; tag?: string }): React.ReactElement {
  return (
    <div className="flex items-baseline gap-3 px-3.5 py-3">
      <span className="min-w-0 flex-1">
        <span className="block text-meta text-text-1">{title}</span>
        <span className="block text-micro text-text-3">{detail}</span>
      </span>
      {tag ? <span className="v2-tag text-text-2">{tag}</span> : null}
    </div>
  );
}

/** Read-only descriptions of how the weaver works today — not controls (VS-348, captain's decision). */
export function WeaverSection(): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <div className="v2-card divide-y divide-line-1">
        <DescRow title="Reviews every approval before you see it" detail="Marks each one unseen, looked or concerns." />
        <DescRow title="Let me override a held card" detail="Recorded on the ticket with your reason." />
        <DescRow title="Model tier default for new tickets" detail="A ticket with no option named runs on the standard tier." tag="standard" />
      </div>
    </div>
  );
}

/** The workspace's identity: its name and ticket prefix (V1's editor, restyled) (VS-348). */
export function GeneralSection(): React.ReactElement {
  const summary = useWorkspaceSummary();
  const patch = usePatchConfig();
  const name = useCommittableField({
    value: summary.data?.workspace.name ?? '',
    onCommit: async (raw) => {
      const trimmed = raw.trim();
      if (!trimmed) throw new Error('Name cannot be empty');
      await patch.mutateAsync({ name: trimmed });
    },
  });
  return (
    <div className="v2-card divide-y divide-line-1">
      <label className="v2-form-row">
        <span className="ac-label">Name</span>
        <div className="flex items-center gap-2">
          <input
            aria-label="Workspace name"
            className="v2-input"
            value={name.draft}
            onChange={(e) => name.onChange(e.target.value)}
            onBlur={name.onBlur}
            onKeyDown={name.onKeyDown}
          />
          <CommitStatus status={name.status} error={name.error} onSave={name.commitNow} />
        </div>
      </label>
      <label className="v2-form-row">
        <span className="ac-label">Ticket prefix</span>
        <input aria-label="Ticket prefix" className={cx('v2-input', 'ac-mono')} value={summary.data?.workspace.ticketPrefix ?? ''} readOnly />
        <span className="text-micro text-text-3">Used for every identifier in this workspace.</span>
      </label>
    </div>
  );
}

/** The workspace's loaded plugins, read-only (V1's list, restyled) (VS-348). */
export function PluginsSection(): React.ReactElement {
  const summary = useWorkspaceSummary();
  const plugins: T.WorkspacePlugin[] | undefined = summary.data?.plugins;
  if (!plugins || plugins.length === 0) return <p className="text-micro text-text-3">No plugins are configured for this workspace, or the daemon.</p>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-micro leading-relaxed text-text-3">
        Plugins add agent tools, storage, routes and pages. Installing or removing one is editing
        <span className="ac-mono"> workspace.yaml</span> or <span className="ac-mono">daemon.yaml</span> and restarting.
      </p>
      <div className="v2-card divide-y divide-line-1">
        {plugins.map((p) => (
          <div key={p.id} className="flex items-center gap-3 px-3.5 py-2.5">
            <span className="ac-mono w-28 truncate text-meta text-text-1">{p.id}</span>
            <span className="v2-tag text-text-2">{p.loaded ? (p.version ?? 'loaded') : 'failed'}</span>
            <span className="v2-tag text-text-2">{p.source}</span>
            <span className="truncate text-micro text-text-3">{p.error ?? ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const rowCx = 'flex items-center gap-3 px-3.5 py-3';

/** The built-in defaults an unset config field resolves to, so the select can show them honestly. */
const BUILTIN_DEFAULTS = WorkspaceDefaultsSchema.parse({});

/**
 * An enum default whose unset state is shown as the resolved built-in default, labelled
 * "(default)" — an unset field must not look like an explicit pick (VS-348 review).
 */
function DefaultSelect({ label, options, raw, builtin, onChange }: {
  label: string; options: readonly string[]; raw: unknown; builtin: string; onChange: (v: string) => void;
}): React.ReactElement {
  const unset = typeof raw !== 'string';
  const value = unset ? builtin : raw;
  return (
    <label className={rowCx}>
      <span className="min-w-0 flex-1 text-meta text-text-1">{label}</span>
      <select aria-label={label} className="ac-mono h-7 rounded-r4 border border-line-2 bg-bg-input px-2 text-micro"
        value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{unset && o === builtin ? `${o} (default)` : o}</option>)}
      </select>
    </label>
  );
}

/** The workspace's approval and delivery defaults (VS-348); the fields already exist in config. */
export function ApprovalsSection(): React.ReactElement {
  const summary = useWorkspaceSummary();
  const patch = usePatchConfig();
  const config = summary.data?.config ?? {};
  const defaults = (config['defaults'] ?? {}) as Record<string, unknown>;
  const select = (key: string, value: unknown): void => patch.mutate({ defaults: { [key]: value } });
  const bool = (key: string): string => (defaults[key] === true ? 'on' : 'off');
  return (
    <div className="flex flex-col gap-4">
      {/* VS-382: YOLO is per project now; this section only points at where it is set. */}
      <div className="v2-card p-3.5 text-micro text-text-3">
        YOLO mode is set per project. Open <span className="text-text-1">Projects</span> and turn it on for one project; the daemon then grants that project&apos;s plan and merge approvals itself.
      </div>
      <div className="v2-card divide-y divide-line-1">
        <DefaultSelect label="Proposal approval" options={APPROVAL_OWNERS} raw={defaults['proposalApproval']}
          builtin={BUILTIN_DEFAULTS.proposalApproval} onChange={(v) => select('proposalApproval', v)} />
        <DefaultSelect label="Hire approval" options={APPROVAL_OWNERS} raw={defaults['hireApproval']}
          builtin={BUILTIN_DEFAULTS.hireApproval} onChange={(v) => select('hireApproval', v)} />
        <DefaultSelect label="Delivery mode" options={DELIVERY_MODES} raw={defaults['deliveryMode']}
          builtin={BUILTIN_DEFAULTS.deliveryMode} onChange={(v) => select('deliveryMode', v)} />
        <label className={rowCx}>
          <span className="min-w-0 flex-1 text-meta text-text-1">Auto-merge</span>
          <select aria-label="Auto-merge" className="ac-mono h-7 rounded-r4 border border-line-2 bg-bg-input px-2 text-micro"
            value={bool('autoMerge')} onChange={(e) => select('autoMerge', e.target.value === 'on')}>
            <option value="off">off</option>
            <option value="on">on</option>
          </select>
        </label>
      </div>
    </div>
  );
}

/** The real knowledge budgets plus the read-only curation description (VS-348). */
export function KnowledgeSection(): React.ReactElement {
  const config = useWorkspaceSummary().data?.config ?? {};
  return (
    <div className="flex flex-col gap-5">
      <KnowledgeBudgetsSection config={config} />
      <section>
        <div className="ac-label mb-2">Curation</div>
        <div className="v2-card divide-y divide-line-1">
          <DescRow title="Schedule" detail="weekly · Sunday 03:00" />
          <DescRow title="Over budget" detail="curate early" />
        </div>
      </section>
    </div>
  );
}
