import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Segmented } from '../components/Tabs';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import { Badge } from '../components/StatusGlyph';
import { DeviceRow } from '../components/DeviceRow';
import { QR } from '../components/QR';
import { TOTPInput } from '../components/TOTPInput';
import { SkeletonRows } from '../components/Skeleton';
import { ErrorState, EmptyState } from '../components/States';
import { useToast } from '../components/Toast';
import { CommitStatus } from '../components/CommitStatus';
import { useCommittableField } from '../lib/commit-field';
import { parseFieldIssues } from '../lib/schema-field';
import {
  useAddProject,
  useApproveTelegramUser,
  useAuthSessions,
  useCancelUpgrade,
  useClearTelegramToken,
  useSetTranscription,
  useDaemonHostTools,
  useSetDaemonHostTools,
  useTranscription,
  useDaemonUpdate,
  useDaemonUpgrade,
  useDisableTelegramAllowAll,
  useMe,
  useMoveProject,
  usePatchConfig,
  usePatchProject,
  usePresentation,
  usePresentationSurfaces,
  useProjects,
  useRemoveProject,
  useRepoInfo,
  usePutPresentation,
  useRefreshDaemonUpdate,
  useRequestUpgrade,
  useSetTelegramToken,
  useTelegramPending,
  useTelegramTokenStatus,
  useWorkspaceSummary,
  useWorkspaces,
  useWorkers,
} from '../api/hooks';
import { api, getWorkspaceId, setToken } from '../api/client';
import { qk } from '../api/keys';
import type { PresentationBlock, Project, PushCategory } from '@weave-ai/shared';
import { ProjectConfigSchema, ProjectPoliciesSchema, APPROVAL_OWNERS, ARCHIVE_COMMITS, DELIVERY_MODES, MERGE_METHODS, projectLabel } from '@weave-ai/shared';
import type * as T from '../api/types';
import type { TotpSetup } from '../api/types';
import { useHookWs, useWs } from '../api/context';
import { useTheme } from '../lib/theme';
import { TEXT_SIZE_STEPS, useTextSize } from '../v2/textSize';
import { MessageBody, MessageBubble } from '../v2/ChatMessage';
import { readShowSilentTurns, writeShowSilentTurns } from '../lib/chatPrefs';
import { useShowLiveRunOutput, writeShowLiveRunOutput } from '../lib/liveRunPrefs';
import { useDictationDiagnosticsEnabled, writeDictationDiagnosticsEnabled } from '../lib/dictationDiagnostics';
import { useDictationAutoSend, writeDictationAutoSend } from '../lib/dictationAutoSend';
import { UPGRADE_STAGE_LABEL, inFlight, isCancellableUpgrade, isRestarting, runningVersionLabel, shortSha } from '../lib/upgrade';
import { cx } from '../lib/cx';
import { isWorkerConflict, liveWorkerCount, liveWorkersReason, MoveProjectError } from '../lib/moveProject';
import { disablePush, enablePush, subscriptionId, updatePushCategories } from '../lib/push';
import { ago } from '../lib/format';






function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <label className="flex flex-col gap-1.5 py-2.5">
      <span className="ac-label">{label}</span>
      {children}
      {error ? <span className="text-micro text-failed">{error}</span> : null}
      {hint ? <span className="text-micro text-text-3">{hint}</span> : null}
    </label>
  );
}

const inputCx = 'h-9 w-full rounded-r6 border border-line-2 bg-bg-input px-3 text-body text-text-1 outline-none';

/** A project's raw policy value, or undefined when it is unset and so follows the workspace. */
function policyOf(policies: Record<string, unknown> | undefined, key: string): unknown {
  const raw = policies?.[key];
  return raw === undefined || raw === null ? undefined : raw;
}

/**
 * The project's policies with `key` set, or with the key gone when the value is undefined. The
 * project PATCH replaces `policies` wholesale, so every caller spreads the existing record rather
 * than rebuilding it — dropping the key is what returns a policy to inheriting the workspace.
 */
function withPolicy(policies: Record<string, unknown> | undefined, key: string, value: unknown): Record<string, unknown> {
  const { [key]: _dropped, ...rest } = policies ?? {};
  return value === undefined ? rest : { ...rest, [key]: value };
}

/** An enum policy as its select value: absent means it follows the workspace. */
function enumPolicyValue(policies: Record<string, unknown> | undefined, key: string): string {
  const raw = policyOf(policies, key);
  return raw === undefined ? 'inherit' : String(raw);
}

/** An approval-owner policy as its select value, showing the row's legacy `conductor` as `weaver` (VS-263). */
function approvalOwnerValue(policies: Record<string, unknown> | undefined, key: string): string {
  const raw = enumPolicyValue(policies, key);
  return raw === 'conductor' ? 'weaver' : raw;
}

/** A boolean policy as its select value: absent means it follows the workspace. */
function booleanPolicyValue(policies: Record<string, unknown> | undefined, key: string): 'inherit' | 'on' | 'off' {
  const raw = policyOf(policies, key);
  return raw === true ? 'on' : raw === false ? 'off' : 'inherit';
}

/** The `inherit` option's label, naming the workspace's value where it actually has one (VS-303). */
function inheritLabel(workspaceValue: string | undefined): string {
  return workspaceValue === undefined ? 'inherit' : `inherit (${workspaceValue})`;
}

/** One policy's select in a project's Delivery & setup panel. `value` is an option value or `inherit`. */
function PolicySelect({
  p,
  policyKey,
  label,
  options,
  value,
  workspaceValue,
  toValue = (raw: string) => raw,
  onSelect,
}: {
  p: Project;
  policyKey: string;
  label: string;
  options: readonly string[];
  value: string;
  workspaceValue?: string;
  /** How an option value becomes the stored policy value; booleans map `on`/`off` to `true`/`false`. */
  toValue?: (raw: string) => unknown;
  onSelect: (key: string, value: unknown) => void;
}): React.ReactElement {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="ac-label">{label}</span>
      <select
        aria-label={`${label} for ${p.slug}`}
        className="ac-mono h-7 rounded-r4 border border-line-2 bg-bg-input px-2 text-micro"
        value={value}
        onChange={(e) => onSelect(policyKey, e.target.value === 'inherit' ? undefined : toValue(e.target.value))}
      >
        <option value="inherit">{inheritLabel(workspaceValue)}</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}



/** The knowledge budgets, in tokens. A budget is what curation is triggered at, so the human owns it. */
const BUDGET_FIELDS = [
  { key: 'project', label: 'Project knowledge base', hint: 'Each PROJECT.md. Injected in full into every worker of that project.' },
  { key: 'document', label: 'Linked document', hint: 'Each [[slug]] page. Read on demand, never injected.' },
  { key: 'workspace', label: 'Workspace knowledge base', hint: 'WORKSPACE.md. Weaver only.' },
  { key: 'shared', label: 'Shared conventions', hint: 'SHARED.md. Read by every agent, so it costs the most per token.' },
  { key: 'decisions', label: 'Decision log', hint: 'decisions.md. Appended by the daemon; only its last 30 lines reach a digest.' },
] as const;

/** One budget field: its own commit state, so a validation rejection on one field never touches another. */
function BudgetField({ label, hint, value, min, step, onCommit }: {
  label: string;
  hint?: string;
  value: number | undefined;
  min: number;
  step: number;
  onCommit: (n: number) => Promise<void>;
}): React.ReactElement {
  const field = useCommittableField({
    value: value !== undefined ? String(value) : '',
    onCommit: async (raw) => {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < min) throw new Error(`Must be a whole number of at least ${min}`);
      await onCommit(n);
    },
  });
  return (
    <Field label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={min}
          step={step}
          aria-label={label}
          className={cx(inputCx, 'ac-mono')}
          value={field.draft}
          onChange={(e) => field.onChange(e.target.value)}
          onBlur={field.onBlur}
          onKeyDown={field.onKeyDown}
        />
        <CommitStatus status={field.status} error={field.error} onSave={field.commitNow} />
      </div>
    </Field>
  );
}

export function KnowledgeBudgetsSection({ config }: { config: Record<string, unknown> }): React.ReactElement {
  const patch = usePatchConfig();
  const defaults = (config['defaults'] ?? {}) as Record<string, unknown>;
  const budgets = (defaults['knowledgeBudgetTokens'] ?? {}) as Record<string, number | undefined>;

  return (
    <section>
      <div className="ac-label mb-2">Knowledge budgets</div>
      <p className="mb-1 text-micro text-text-3">
        In tokens. A file over 80 % of its budget schedules a curation run; a write that would cross it is rejected.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {BUDGET_FIELDS.map((f) => (
          <BudgetField
            key={f.key}
            label={f.label}
            hint={f.hint}
            value={budgets[f.key]}
            min={500}
            step={500}
            onCommit={(n) => patch.mutateAsync({ defaults: { knowledgeBudgetTokens: { [f.key]: n } } }).then(() => undefined)}
          />
        ))}
        <BudgetField
          label="Bootstrap digest"
          hint="The knowledge injected on an agent's first turn. Keep it above shared + project."
          value={defaults['bootstrapBudgetTokens'] as number | undefined}
          min={500}
          step={1000}
          onCommit={(n) => patch.mutateAsync({ defaults: { bootstrapBudgetTokens: n } }).then(() => undefined)}
        />
      </div>
    </section>
  );
}

function moveFailureCopy(err: MoveProjectError, destName: string): string {
  if (err.kind === 'archive_failed') {
    return `${destName} already has this project. Remove it from this workspace.`;
  }
  if (err.kind === 'add_failed') {
    return `Could not add the project to ${destName}. It is still in this workspace — retry Move.`;
  }
  return err.message;
}

function RemoveProjectSheet({
  project,
  liveCount,
  onClose,
}: {
  project: Project;
  liveCount: number;
  onClose: () => void;
}): React.ReactElement {
  const remove = useRemoveProject();
  const [reason, setReason] = useState<string | null>(liveCount > 0 ? liveWorkersReason(project.slug, liveCount) : null);

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Remove ${projectLabel(project)}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            disabled={liveCount > 0 || remove.isPending}
            onClick={() => {
              void remove.mutateAsync({ id: project.id }).then(onClose).catch((err: unknown) => {
                if (isWorkerConflict(err)) {
                  setReason(err instanceof Error ? err.message : liveWorkersReason(project.slug, liveCount));
                  return;
                }
                setReason(err instanceof Error ? err.message : 'Could not remove the project');
              });
            }}
          >
            Confirm
          </Button>
        </>
      }
    >
      <p className="text-body text-text-2">
        {projectLabel(project)} will be archived, not deleted. Tickets and knowledge stay in this workspace. The clone is left on disk.
      </p>
      {reason ? <p className="mt-3 text-micro text-failed">{reason}</p> : null}
    </Sheet>
  );
}

function MoveProjectSheet({
  project,
  destinations,
  liveCount,
  onClose,
}: {
  project: Project;
  destinations: T.WorkspaceListItem[];
  liveCount: number;
  onClose: () => void;
}): React.ReactElement {
  const move = useMoveProject();
  const [destId, setDestId] = useState('');
  const destProjects = useProjects(destId);
  const [reason, setReason] = useState<string | null>(liveCount > 0 ? liveWorkersReason(project.slug, liveCount) : null);
  const dest = destinations.find((w) => w.id === destId);
  const destName = dest?.name ?? 'the destination';
  const destClash = destId ? (destProjects.data ?? []).some((p) => p.slug === project.slug) : false;
  const clashReason = destClash ? `The destination already has a project named ${project.slug}` : null;
  const shownReason = reason ?? clashReason;

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Move ${projectLabel(project)}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!destId || liveCount > 0 || move.isPending}
            onClick={() => {
              void move.mutateAsync({ destWs: destId, project }).then(onClose).catch((err: unknown) => {
                if (err instanceof MoveProjectError) {
                  setReason(moveFailureCopy(err, destName));
                  return;
                }
                if (isWorkerConflict(err)) {
                  setReason(err instanceof Error ? err.message : liveWorkersReason(project.slug, liveCount));
                  return;
                }
                setReason(err instanceof Error ? err.message : 'Could not move the project');
              });
            }}
          >
            Confirm
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <select
          aria-label="Destination workspace"
          className={cx(inputCx, 'ac-mono')}
          value={destId}
          onChange={(e) => {
            setDestId(e.target.value);
            setReason(null);
          }}
        >
          <option value="">Choose a workspace</option>
          {destinations.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
        {dest ? (
          <p className="text-body text-text-2">
            The repository and copied project settings go to {dest.name}. Tickets, knowledge, spec index, runs and usage stay in this workspace under the archived project. The clone on disk here is left; {dest.name} clones afresh.
          </p>
        ) : (
          <p className="text-body text-text-2">Choose a workspace to see what travels and what stays.</p>
        )}
        {shownReason ? <p className="text-micro text-failed">{shownReason}</p> : null}
      </div>
    </Sheet>
  );
}

function ArchivedProjectRow({ p }: { p: Project }): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-3 px-3.5 py-3">
      <span className="text-meta text-text-1">{projectLabel(p)}</span>
      {projectLabel(p) !== p.slug ? <span className="ac-mono text-micro text-text-3">{p.slug}</span> : null}
      <Badge>{p.status}</Badge>
      <span className="ac-mono ac-truncate flex-1 text-micro text-text-3">{p.gitUrl}</span>
    </div>
  );
}

/** A workspace's values for the two policies it can set a default for; the rest inherit the schema. */
type WorkspacePolicyDefaults = { proposalApproval?: string; deliveryMode?: string };

/** The workspace defaults that a project policy can fall back to, from `GET /api/w/:ws`'s config. */
function workspacePolicyDefaults(config: Record<string, unknown>): WorkspacePolicyDefaults {
  const defaults = (config['defaults'] ?? {}) as Record<string, unknown>;
  const pick = (key: string): string | undefined => (typeof defaults[key] === 'string' ? (defaults[key] as string) : undefined);
  return { proposalApproval: pick('proposalApproval'), deliveryMode: pick('deliveryMode') };
}

/** One project's row: its own `maxWorkers`/`landingBranch`/policy commit state, independent of every other row. */
function ActiveProjectRow({
  p,
  workspaceDefaults,
  liveCount,
  destinations,
}: {
  p: Project;
  workspaceDefaults: WorkspacePolicyDefaults;
  liveCount: number;
  destinations: T.WorkspaceListItem[];
}): React.ReactElement {
  const patch = usePatchProject();
  const repoInfo = useRepoInfo();
  const [sheet, setSheet] = useState<null | 'remove' | 'move'>(null);
  const [confirmYolo, setConfirmYolo] = useState(false);
  const [open, setOpen] = useState(false);
  const [publicWarning, setPublicWarning] = useState(false);
  const blocked = liveCount > 0;
  const yoloOn = booleanPolicyValue(p.policies, 'yolo') === 'on';
  const blockReason = blocked ? liveWorkersReason(p.slug, liveCount) : null;

  const maxWorkers = useCommittableField({
    value: String(p.maxWorkers),
    onCommit: async (raw) => {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1) throw new Error('Must be a whole number of at least 1');
      await patch.mutateAsync({ id: p.id, patch: { maxWorkers: n } });
    },
  });

  const landingBranch = useCommittableField({
    value: p.landingBranch ?? '',
    onCommit: async (raw) => {
      await patch.mutateAsync({ id: p.id, patch: { landingBranch: raw.trim() } });
    },
  });

  // The display name (VS-330): an empty commit clears it, and every label falls back to the slug.
  const displayName = useCommittableField({
    value: p.name ?? '',
    onCommit: async (raw) => {
      await patch.mutateAsync({ id: p.id, patch: { name: raw.trim() } });
    },
  });

  // The number policy's bounds come from the schema the route validates with (VS-303), not a literal.
  const mergeConcurrencySchema = ProjectPoliciesSchema.shape.mergeConcurrency.unwrap().removeDefault();
  const mergeConcurrency = useCommittableField({
    value: policyOf(p.policies, 'mergeConcurrency') === undefined ? '' : String(policyOf(p.policies, 'mergeConcurrency')),
    onCommit: async (raw) => {
      const trimmed = raw.trim();
      if (trimmed === '') {
        await patch.mutateAsync({ id: p.id, patch: { policies: withPolicy(p.policies, 'mergeConcurrency', undefined) } });
        return;
      }
      const n = Number(trimmed);
      const issues = parseFieldIssues(mergeConcurrencySchema, n);
      if (!issues.valid) {
        const { minValue, maxValue } = mergeConcurrencySchema;
        throw new Error(
          minValue != null && maxValue != null
            ? `A whole number from ${minValue} to ${maxValue}.`
            : 'Enter a whole number within the allowed range.',
        );
      }
      await patch.mutateAsync({ id: p.id, patch: { policies: withPolicy(p.policies, 'mergeConcurrency', n) } });
    },
  });

  const setupCommand = useCommittableField({
    value: p.setupCommand ?? '',
    onCommit: async (raw) => {
      await patch.mutateAsync({ id: p.id, patch: { setupCommand: raw.trim() } });
    },
  });

  const setPolicy = (key: string, value: unknown): void => {
    patch.mutate({ id: p.id, patch: { policies: withPolicy(p.policies, key, value) } });
  };

  /**
   * VS-359: enabling the knowledge-repo opt-in consults the forge first and, when the repository is
   * reported public, shows a warning before confirming; any other case patches immediately. The
   * warning is advisory — an unreachable forge never blocks the change.
   */
  const changeKnowledgeRepo = async (next: 'on' | 'off'): Promise<void> => {
    if (next === 'on' && !p.knowledgeRepoEnabled) {
      try {
        const info = await repoInfo.mutateAsync({ id: p.id });
        if (info?.private === false) { setPublicWarning(true); return; }
      } catch { /* advisory only: proceed when the forge cannot answer */ }
    }
    setPublicWarning(false);
    patch.mutate({ id: p.id, patch: { knowledgeRepo: { enabled: next === 'on' } } });
  };

  /** VS-578: the per-project OpenSpec mode, a direct toggle; the daemon applies it to tickets created afterwards. */
  const changeOpenspec = (next: 'on' | 'off'): void => {
    patch.mutate({ id: p.id, patch: { openspec: { enabled: next === 'on' } } });
  };

  return (
    <div className="px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-meta text-text-1">{projectLabel(p)}</span>
        {projectLabel(p) !== p.slug ? <span className="ac-mono text-micro text-text-3">{p.slug}</span> : null}
        <Badge>{p.status}</Badge>
        <span className="ac-mono ac-truncate flex-1 text-micro text-text-3">{p.gitUrl}</span>
        <label className="flex flex-wrap items-center gap-1.5">
          <span className="ac-label">name</span>
          <input
            aria-label={`name for ${p.slug}`}
            placeholder={p.slug}
            value={displayName.draft}
            onChange={(e) => displayName.onChange(e.target.value)}
            onBlur={displayName.onBlur}
            onKeyDown={displayName.onKeyDown}
            className="h-7 w-32 rounded-r4 border border-line-2 bg-bg-input px-2 text-micro"
          />
          <CommitStatus status={displayName.status} error={displayName.error} onSave={displayName.commitNow} />
        </label>
        <label className="flex flex-wrap items-center gap-1.5">
          <span className="ac-label">workers</span>
          <input
            type="number"
            min={1}
            value={maxWorkers.draft}
            onChange={(e) => maxWorkers.onChange(e.target.value)}
            onBlur={maxWorkers.onBlur}
            onKeyDown={maxWorkers.onKeyDown}
            className="ac-mono h-7 w-14 rounded-r4 border border-line-2 bg-bg-input px-2 text-micro"
          />
          <CommitStatus status={maxWorkers.status} error={maxWorkers.error} onSave={maxWorkers.commitNow} />
        </label>
        <label className="flex flex-wrap items-center gap-1.5">
          <span className="ac-label">landing branch</span>
          <input
            aria-label={`landing branch for ${p.slug}`}
            placeholder={p.defaultBranch}
            value={landingBranch.draft}
            onChange={(e) => landingBranch.onChange(e.target.value)}
            onBlur={landingBranch.onBlur}
            onKeyDown={landingBranch.onKeyDown}
            className="ac-mono h-7 w-28 rounded-r4 border border-line-2 bg-bg-input px-2 text-micro"
          />
          <CommitStatus status={landingBranch.status} error={landingBranch.error} onSave={landingBranch.commitNow} />
        </label>
        <button
          type="button"
          role="switch"
          aria-checked={yoloOn}
          aria-label={`YOLO mode for ${p.slug}`}
          title={yoloOn ? 'The daemon grants this project’s plan and merge approvals itself.' : 'Off: approvals for this project come to you.'}
          onClick={() => (yoloOn ? setPolicy('yolo', undefined) : setConfirmYolo(true))}
          className={cx(
            'ac-mono rounded-r4 border px-2 text-micro',
            yoloOn ? 'border-needs-you/50 bg-needs-you/15 text-needs-you' : 'border-line-2 text-text-3',
          )}
        >
          {yoloOn ? 'YOLO on' : 'YOLO off'}
        </button>
        <div className="flex flex-wrap items-center gap-2">
          {blockReason ? <span className="text-micro text-text-3">{blockReason}</span> : null}
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={open}
            aria-label={`Delivery and setup for ${p.slug}`}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Hide delivery & setup' : 'Delivery & setup'}
          </Button>
          <Button size="sm" variant="ghost" disabled={blocked} onClick={() => setSheet('remove')}>Remove</Button>
          {destinations.length > 0 ? (
            <Button size="sm" variant="ghost" disabled={blocked} onClick={() => setSheet('move')}>Move</Button>
          ) : null}
        </div>
      </div>
      {open ? (
        <div className="mt-3 grid gap-x-4 gap-y-2.5 border-t border-line-1 pt-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field
              label="Setup command"
              hint="Runs shell in the project clone before each new worktree's first turn. Also set in the add form above."
            >
              <div className="flex items-center gap-2">
                <input
                  aria-label={`setup command for ${p.slug}`}
                  className={cx(inputCx, 'ac-mono')}
                  placeholder="pnpm install"
                  value={setupCommand.draft}
                  onChange={(e) => setupCommand.onChange(e.target.value)}
                  onBlur={setupCommand.onBlur}
                  onKeyDown={setupCommand.onKeyDown}
                />
                <CommitStatus status={setupCommand.status} error={setupCommand.error} onSave={setupCommand.commitNow} />
              </div>
            </Field>
          </div>
          <PolicySelect
            p={p}
            policyKey="proposalApproval"
            label="proposal approval"
            options={APPROVAL_OWNERS}
            value={approvalOwnerValue(p.policies, 'proposalApproval')}
            workspaceValue={workspaceDefaults.proposalApproval}
            onSelect={setPolicy}
          />
          <PolicySelect
            p={p}
            policyKey="taskApproval"
            label="task approval"
            options={APPROVAL_OWNERS}
            value={approvalOwnerValue(p.policies, 'taskApproval')}
            onSelect={setPolicy}
          />
          <PolicySelect
            p={p}
            policyKey="mergeMethod"
            label="merge method"
            options={MERGE_METHODS}
            value={enumPolicyValue(p.policies, 'mergeMethod')}
            onSelect={setPolicy}
          />
          <PolicySelect
            p={p}
            policyKey="deliveryMode"
            label="delivery mode"
            options={DELIVERY_MODES}
            value={enumPolicyValue(p.policies, 'deliveryMode')}
            workspaceValue={workspaceDefaults.deliveryMode}
            onSelect={setPolicy}
          />
          <PolicySelect
            p={p}
            policyKey="archiveCommit"
            label="archive commit"
            options={ARCHIVE_COMMITS}
            value={enumPolicyValue(p.policies, 'archiveCommit')}
            onSelect={setPolicy}
          />
          <PolicySelect
            p={p}
            policyKey="requireCi"
            label="require CI"
            options={['on', 'off']}
            value={booleanPolicyValue(p.policies, 'requireCi')}
            toValue={(raw) => raw === 'on'}
            onSelect={setPolicy}
          />
          <PolicySelect
            p={p}
            policyKey="autoMergeDefault"
            label="auto-merge default"
            options={['on', 'off']}
            value={booleanPolicyValue(p.policies, 'autoMergeDefault')}
            toValue={(raw) => raw === 'on'}
            onSelect={setPolicy}
          />
          {p.knowledgeSwitch ? (
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2" aria-label={`knowledge-repo switch for ${p.slug}`}>
              <span className="text-micro text-stalled">Waiting for the pull request to merge.</span>
              <a href={p.knowledgeSwitch.prUrl} target="_blank" rel="noreferrer" className="ac-mono ac-truncate max-w-full text-micro text-accent-link hover:underline">
                {p.knowledgeSwitch.prUrl}
              </a>
              <span className="text-micro text-text-3">Close the pull request to cancel the change.</span>
            </div>
          ) : publicWarning ? (
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2" aria-label={`public repository warning for ${p.slug}`}>
              <span className="text-micro text-stalled">
                This repository is public — {p.slug}&apos;s knowledge would be committed where anyone can read it.
              </span>
              <Button size="sm" variant="ghost" onClick={() => { setPublicWarning(false); patch.mutate({ id: p.id, patch: { knowledgeRepo: { enabled: true } } }); }}>
                Turn on anyway
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPublicWarning(false)}>Cancel</Button>
            </div>
          ) : (
            <label className="flex items-center justify-between gap-2">
              <span className="ac-label">commit knowledge to repo</span>
              <select
                aria-label={`commit knowledge to repo for ${p.slug}`}
                className="ac-mono h-7 rounded-r4 border border-line-2 bg-bg-input px-2 text-micro"
                value={p.knowledgeRepoEnabled ? 'on' : 'off'}
                onChange={(e) => void changeKnowledgeRepo(e.target.value === 'on' ? 'on' : 'off')}
              >
                <option value="off">off</option>
                <option value="on">on</option>
              </select>
            </label>
          )}
          <label className="flex items-center justify-between gap-2">
            <span className="ac-label">OpenSpec</span>
            <select
              aria-label={`openspec for ${p.slug}`}
              className="ac-mono h-7 rounded-r4 border border-line-2 bg-bg-input px-2 text-micro"
              value={p.openspecEnabled ? 'on' : 'off'}
              onChange={(e) => changeOpenspec(e.target.value === 'on' ? 'on' : 'off')}
            >
              <option value="on">on</option>
              <option value="off">off</option>
            </select>
          </label>
          <Field label="Merge concurrency" hint="How many of this project's tickets may be in the active merge step at once.">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={mergeConcurrencySchema.minValue ?? undefined}
                max={mergeConcurrencySchema.maxValue ?? undefined}
                aria-label={`merge concurrency for ${p.slug}`}
                className={cx(inputCx, 'ac-mono')}
                value={mergeConcurrency.draft}
                onChange={(e) => mergeConcurrency.onChange(e.target.value)}
                onBlur={mergeConcurrency.onBlur}
                onKeyDown={mergeConcurrency.onKeyDown}
              />
              <CommitStatus status={mergeConcurrency.status} error={mergeConcurrency.error} onSave={mergeConcurrency.commitNow} />
            </div>
          </Field>
        </div>
      ) : null}
      {sheet === 'remove' ? (
        <RemoveProjectSheet project={p} liveCount={liveCount} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'move' ? (
        <MoveProjectSheet project={p} destinations={destinations} liveCount={liveCount} onClose={() => setSheet(null)} />
      ) : null}
      <Sheet
        open={confirmYolo}
        onClose={() => setConfirmYolo(false)}
        title={`Turn on YOLO mode for ${projectLabel(p)}?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmYolo(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                setPolicy('yolo', true);
                setConfirmYolo(false);
              }}
            >
              Turn on YOLO
            </Button>
          </>
        }
      >
        <p className="text-body text-text-2">
          The daemon will grant <span className="text-text-1">{projectLabel(p)}</span>&apos;s plan and merge approvals itself: the plan as soon as it validates,
          the merge as soon as its checks are green. Each is recorded as answered by the system.
        </p>
        <p className="mt-2 text-meta text-text-3">
          Action approvals always stay with you, as do hires, discards, retries and questions. Nothing skips CI, the merge queue or the landing check.
        </p>
      </Sheet>
    </div>
  );
}

function ProjectRow({
  p,
  workspaceDefaults,
  liveCount,
  destinations,
}: {
  p: Project;
  workspaceDefaults: WorkspacePolicyDefaults;
  liveCount: number;
  destinations: T.WorkspaceListItem[];
}): React.ReactElement {
  if (p.status === 'archived') return <ArchivedProjectRow p={p} />;
  return <ActiveProjectRow p={p} workspaceDefaults={workspaceDefaults} liveCount={liveCount} destinations={destinations} />;
}

export function ProjectsSection(): React.ReactElement {
  const projects = useProjects();
  const add = useAddProject();
  const workers = useWorkers();
  const workspaces = useWorkspaces();
  const currentWs = useWs();
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [maxWorkersText, setMaxWorkersText] = useState('2');
  const [setupCommand, setSetupCommand] = useState('');
  const [autoMergeDefault, setAutoMergeDefault] = useState(false);
  const [knowledgeRepoEnabled, setKnowledgeRepoEnabled] = useState(false);
  // VS-578: OpenSpec defaults on for a new project.
  const [openspecEnabled, setOpenspecEnabled] = useState(true);
  const [createPublicWarning, setCreatePublicWarning] = useState(false);
  const repoInfo = useRepoInfo();
  const config = useWorkspaceSummary().data?.config ?? {};
  const workspaceDefaults = workspacePolicyDefaults(config);
  const destinations = (workspaces.data ?? []).filter((w) => w.id !== currentWs);

  // Max workers checked against the shared project schema the route itself validates with (VS-212) —
  // the bounds stay derived, never restated here.
  const maxWorkersSchema = ProjectConfigSchema.shape.maxWorkers.removeDefault();
  const maxWorkersIssues = parseFieldIssues(maxWorkersSchema, Number(maxWorkersText));
  const maxWorkersValid = maxWorkersIssues.valid;
  const maxWorkersError =
    maxWorkersText.trim() && !maxWorkersValid
      ? maxWorkersSchema.minValue != null && maxWorkersSchema.maxValue != null
        ? `A whole number from ${maxWorkersSchema.minValue} to ${maxWorkersSchema.maxValue}.`
        : maxWorkersIssues.byPath['']
      : undefined;
  const maxWorkers = Number(maxWorkersText);

  /** VS-359: checking the box consults the forge for the URL and warns when the repository is public. */
  const changeCreateKnowledgeRepo = async (checked: boolean): Promise<void> => {
    setKnowledgeRepoEnabled(checked);
    setCreatePublicWarning(false);
    if (!checked || !url) return;
    try {
      const info = await repoInfo.mutateAsync({ url });
      if (info?.private === false) setCreatePublicWarning(true);
    } catch { /* advisory only: proceed when the forge cannot answer */ }
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="ac-card p-3.5">
        <div className="ac-label mb-2">Add a project</div>
        <Field label="Git URL" hint="Cloned into projects/<id>; nobody works in that clone.">
          <input className={cx(inputCx, 'ac-mono')} placeholder="git@github.com:acme/api.git" value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Max workers" error={maxWorkersError}>
            <input
              type="number"
              min={maxWorkersSchema.minValue ?? undefined}
              max={maxWorkersSchema.maxValue ?? undefined}
              className={cx(inputCx, 'ac-mono')}
              value={maxWorkersText}
              onChange={(e) => setMaxWorkersText(e.target.value)}
            />
          </Field>
          <Field label="Auto-merge default">
            <select className={cx(inputCx, 'ac-mono')} value={autoMergeDefault ? 'on' : 'off'} onChange={(e) => setAutoMergeDefault(e.target.value === 'on')}>
              <option value="off">off</option>
              <option value="on">on</option>
            </select>
          </Field>
        </div>
        <Field label="Setup command" hint="Run once per worktree before the first turn.">
          <input className={cx(inputCx, 'ac-mono')} placeholder="pnpm install" value={setupCommand} onChange={(e) => setSetupCommand(e.target.value)} />
        </Field>
        <label className="mt-1 flex items-center gap-2 text-micro text-text-2">
          <input
            type="checkbox"
            aria-label="Commit knowledge to repo"
            checked={knowledgeRepoEnabled}
            onChange={(e) => void changeCreateKnowledgeRepo(e.target.checked)}
          />
          Commit this project&apos;s knowledge to its own repo, at <code className="ac-mono">.weave/knowledge/</code>.
        </label>
        <label className="mt-1 flex items-center gap-2 text-micro text-text-2">
          <input
            type="checkbox"
            aria-label="Use OpenSpec"
            checked={openspecEnabled}
            onChange={(e) => setOpenspecEnabled(e.target.checked)}
          />
          Use OpenSpec for this project&apos;s change tickets (proposal, specs, tasks, archive). Turn it off for internal projects that want the fast path.
        </label>
        {createPublicWarning ? (
          <div className="mt-1 text-micro text-stalled" role="status" aria-label="public repository warning">
            This repository is public — its knowledge would be committed where anyone can read it.
          </div>
        ) : null}
        <Button
          variant="primary"
          disabled={!url || !maxWorkersValid || add.isPending}
          onClick={() =>
            add.mutate(
              { url, maxWorkers, ...(setupCommand ? { setupCommand } : {}), policies: { autoMergeDefault }, knowledgeRepo: { enabled: knowledgeRepoEnabled }, openspec: { enabled: openspecEnabled } },
              {
                onSuccess: () => {
                  toast.push({ title: 'Cloning…', detail: url, status: 'working' });
                  setUrl('');
                },
                onError: (e) => toast.push({ title: 'Could not add the project', detail: e.message, status: 'failed' }),
              },
            )
          }
        >
          Add project
        </Button>
      </section>

      {projects.isLoading ? (
        <SkeletonRows rows={3} />
      ) : (projects.data?.length ?? 0) === 0 ? (
        <EmptyState title="No projects yet." detail="Paste a git URL above, or ask the weaver to add one." />
      ) : (
        <div className="ac-card divide-y divide-line-1">
          {(projects.data ?? []).map((p) => (
            <ProjectRow
              key={p.id}
              p={p}
              workspaceDefaults={workspaceDefaults}
              liveCount={liveWorkerCount(workers.data ?? [], p.id)}
              destinations={destinations}
            />
          ))}
        </div>
      )}
    </div>
  );
}













/**
 * VS-318: whether the daemon can find the host tools it needs, and the escape hatch for a layout the
 * user's login shell does not cover. Zero configuration is the norm; this only helps the exception.
 * Saving persists `hostToolPaths` to daemon.yaml and re-resolves live, no restart.
 */
export function HostToolsSection(): React.ReactElement {
  const hostTools = useDaemonHostTools();
  const save = useSetDaemonHostTools();
  const [draft, setDraft] = useState<string | null>(null);

  if (hostTools.isLoading) return <SkeletonRows rows={3} />;
  if (!hostTools.data) return <ErrorState code="HOST_TOOLS_UNREACHABLE" message="The daemon host tools could not be read." />;

  const { tools, paths } = hostTools.data;
  const value = draft ?? paths.join('\n');
  const parsed = value.split('\n').map((p) => p.trim()).filter(Boolean);
  const dirty = draft !== null && parsed.join('\n') !== paths.join('\n');

  return (
    <div className="flex flex-col gap-4">
      <p className="text-micro leading-relaxed text-text-3">
        The daemon resolves these from the login shell of the user it runs as, so it needs no configuration. Add a directory below only when your tools live somewhere that shell does not know about.
      </p>
      <div className="flex flex-col divide-y divide-line-1 rounded-r6 border border-line-2">
        {tools.map((t) => (
          <div key={t.id} className="flex items-center gap-3 px-3 py-2.5">
            <span className="ac-mono w-20 text-body text-text-1">{t.id}</span>
            <Badge tone={t.available ? 'added' : t.need === 'required' ? 'removed' : 'modified'}>
              {t.available ? (t.version ?? 'available') : `${t.need}, missing`}
            </Badge>
            <span className="truncate text-micro text-text-3">{t.path ?? t.purpose}</span>
          </div>
        ))}
      </div>
      <Field label="Tool directories" hint="One absolute directory per line. Searched before the login-shell PATH.">
        <textarea
          className={cx(inputCx, 'ac-mono h-24 py-2')}
          aria-label="Tool directories"
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="/opt/tools/bin"
        />
      </Field>
      {save.error ? <ErrorState code="HOST_TOOLS_NOT_SAVED" message={save.error.message} /> : null}
      <div className="flex justify-end">
        <Button onClick={() => save.mutate({ paths: parsed }, { onSuccess: () => setDraft(null) })} disabled={!dirty || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save directories'}
        </Button>
      </div>
    </div>
  );
}


/** Which of the three rules is in force for an empty-or-populated allowlist (VS-125 criterion: state it, don't leave it implicit). */
function allowlistRuleLabel(telegram: { allowedUserIds?: number[]; allowAll?: boolean }): { text: string; tone: 'added' | 'accent' | 'removed' } {
  const ids = telegram.allowedUserIds ?? [];
  if (ids.length) return { text: `Locked to ${ids.length} user${ids.length === 1 ? '' : 's'}`, tone: 'accent' };
  if (telegram.allowAll) return { text: 'Open to any Telegram user', tone: 'removed' };
  return { text: 'Off — no user is allowed', tone: 'added' };
}

export function ChannelsSection(): React.ReactElement {
  const summary = useWorkspaceSummary();
  const patch = usePatchConfig();
  const tokenStatus = useTelegramTokenStatus();
  const setTelegramToken = useSetTelegramToken();
  const clearToken = useClearTelegramToken();
  const pending = useTelegramPending();
  const approveUser = useApproveTelegramUser();
  const disableAllowAll = useDisableTelegramAllowAll();
  const toast = useToast();
  const [pendingToken, setPendingToken] = useState('');
  const channels = (summary.data?.config?.['channels'] ?? {}) as Record<string, { allowedUserIds?: number[]; allowAll?: boolean }>;
  const telegram = channels['telegram'] ?? {};
  const rule = allowlistRuleLabel(telegram);
  const allowlist = useCommittableField({
    value: (telegram.allowedUserIds ?? []).join(', '),
    onCommit: async (raw) => {
      const allowedUserIds = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number)
        .filter((n) => Number.isInteger(n));
      await patch.mutateAsync({ channels: { telegram: { ...telegram, allowedUserIds } } });
    },
  });

  const save = (): void => {
    void setTelegramToken
      .mutateAsync(pendingToken)
      .then((r) => {
        toast.push({ title: 'Telegram token saved', detail: r.botUsername ? `Confirmed as @${r.botUsername}` : undefined, status: 'done' });
        setPendingToken('');
      })
      .catch((e: Error) => toast.push({ title: 'Could not save the token', detail: e.message, status: 'failed' }));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="ac-label">Telegram</div>
      <p className="text-micro text-text-3">The channel is on exactly when a bot token is configured below, and off when it is not.</p>

      <Field
        label="Bot token"
        hint={
          tokenStatus.data?.configured
            ? tokenStatus.data.source === 'env'
              ? "Configured via an ${ENV_VAR} reference in workspace.yaml. Saving here switches this workspace to the secret store, which then takes precedence."
              : `Configured, held in the workspace secret store${tokenStatus.data.botUsername ? ` — confirmed as @${tokenStatus.data.botUsername}` : ''}. Never shown here again once saved.`
            : 'Not configured — the channel is off for lack of a token. Paste one from @BotFather and save; it is validated against Telegram before it is accepted.'
        }
      >
        <div className="flex gap-2">
          <input
            type="password"
            aria-label="Bot token"
            className={cx(inputCx, 'ac-mono')}
            placeholder={tokenStatus.data?.configured ? 'Replace the current token…' : 'Paste the bot token…'}
            value={pendingToken}
            onChange={(e) => setPendingToken(e.target.value)}
            autoComplete="off"
          />
          <Button variant="primary" size="sm" disabled={!pendingToken || setTelegramToken.isPending} onClick={save}>
            Save
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={!tokenStatus.data?.configured || clearToken.isPending}
            onClick={() =>
              void clearToken
                .mutateAsync()
                .then(() => toast.push({ title: 'Telegram token cleared', detail: 'The channel is off.', status: 'done' }))
                .catch((e: Error) => toast.push({ title: 'Could not clear the token', detail: e.message, status: 'failed' }))
            }
          >
            Clear
          </Button>
        </div>
      </Field>

      <Field label="Allowlist" hint="Comma-separated Telegram user ids that may talk to the weaver. Nobody allowed is the safe, intended state — approve people below instead of typing ids.">
        <div className="flex items-center gap-2">
          <input
            aria-label="Allowlist"
            className={cx(inputCx, 'ac-mono')}
            value={allowlist.draft}
            onChange={(e) => allowlist.onChange(e.target.value)}
            onBlur={allowlist.onBlur}
            onKeyDown={allowlist.onKeyDown}
          />
          <CommitStatus status={allowlist.status} error={allowlist.error} onSave={allowlist.commitNow} />
          <Badge tone={rule.tone}>{rule.text}</Badge>
          {telegram.allowAll ? (
            <Button
              variant="danger"
              size="sm"
              disabled={disableAllowAll.isPending}
              onClick={() =>
                void disableAllowAll
                  .mutateAsync()
                  .then(() => toast.push({ title: 'Open access turned off', detail: 'Approve people individually instead.', status: 'done' }))
                  .catch((e: Error) => toast.push({ title: 'Could not turn off open access', detail: e.message, status: 'failed' }))
              }
            >
              Turn off open access
            </Button>
          ) : null}
        </div>
      </Field>

      <PendingTelegramUsers
        users={pending.data?.pending ?? []}
        approving={approveUser.isPending}
        onApprove={(externalUserId) =>
          void approveUser
            .mutateAsync(externalUserId)
            .then(() => toast.push({ title: 'Approved', detail: 'They can now direct work in this workspace through the weaver.', status: 'done' }))
            .catch((e: Error) => toast.push({ title: 'Could not approve', detail: e.message, status: 'failed' }))
        }
      />
    </div>
  );
}

/**
 * Everyone who has messaged the bot while not on the allowlist (VS-135) — identity only, the
 * message that triggered a record is never shown. A plain `<div>`, not `Field` (a `<label>`): there
 * is no form control here for it to label, and with no `<input>` present the Approve button would
 * become the label's only labelable descendant, giving it the whole section's text as its
 * accessible name instead of "Approve".
 */
function PendingTelegramUsers({ users, approving, onApprove }: { users: T.TelegramPendingUser[]; approving: boolean; onApprove: (externalUserId: string) => void }): React.ReactElement | null {
  if (!users.length) return null;
  return (
    <div className="flex flex-col gap-1.5 py-2.5">
      <span className="ac-label">Waiting for approval</span>
      <div className="flex flex-col divide-y divide-line-1 rounded-r6 border border-line-2">
        {users.map((u) => (
          <div key={u.externalUserId} className="flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="ac-truncate text-ui text-text-1">
                {u.displayName ?? u.username ?? u.externalUserId}
                {u.username ? <span className="ac-mono ml-1.5 text-micro text-text-3">@{u.username}</span> : null}
              </div>
              <div className="ac-mono mt-0.5 text-micro text-text-3">
                first seen {ago(u.firstSeenAt)} ago · last tried {ago(u.lastSeenAt)} ago · {u.attemptCount} attempt{u.attemptCount === 1 ? '' : 's'}
              </div>
            </div>
            <Button variant="primary" size="sm" disabled={approving} onClick={() => onApprove(u.externalUserId)}>
              Approve
            </Button>
          </div>
        ))}
      </div>
      <span className="text-micro text-text-3">Approving adds them to the allowlist so they can direct work in this workspace through the weaver.</span>
    </div>
  );
}

export function PresentationSection(): React.ReactElement {
  const presentation = usePresentation();
  const surfaces = usePresentationSurfaces();
  const put = usePutPresentation();
  if (presentation.isLoading) return <SkeletonRows rows={3} />;
  if (presentation.isError || !presentation.data) {
    return (
      <ErrorState
        code="PRESENTATION_UNAVAILABLE"
        message="The daemon did not return a presentation config."
        onRetry={() => void presentation.refetch()}
      />
    );
  }

  const config = presentation.data;
  // The registry list plus whatever is already configured, so a plugin surface this daemon has not
  // loaded still shows as the current choice instead of silently switching the select to something else.
  const options = [...new Set([...(surfaces.data?.surfaces ?? []), config.default])];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-meta leading-relaxed text-text-2">
        Presentation surfaces run on the presenter&apos;s machine, which need not be the daemon&apos;s. The daemon stores only the desired
        config; the presenter detects what is actually available there and reconciles windows locally.
      </p>
      <Field label="Default surface" hint="Used for every agent that has no surface of its own.">
        <select
          className={cx(inputCx, 'ac-mono')}
          value={config.default}
          disabled={put.isPending}
          onChange={(e) => put.mutate({ ...config, default: e.target.value })}
        >
          {options.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
      </Field>
      <dl className="ac-card divide-y divide-line-1">
        <PresentationBlockRow label="Weaver" block={config.weaver} fallback={config.default} />
        <PresentationBlockRow label="Workers" block={config.workers} fallback={config.default} />
      </dl>
    </div>
  );
}

/** One override block, read-only: the surface it pins plus whatever knobs the block carries. */
function PresentationBlockRow({ label, block, fallback }: { label: string; block?: PresentationBlock; fallback: string }): React.ReactElement {
  const detail = block
    ? Object.entries(block)
        .filter(([key, value]) => key !== 'surface' && value !== undefined)
        .map(([key, value]) => `${key}: ${String(value)}`)
    : [];
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5">
      <dt className="flex-1 text-meta text-text-1">{label}</dt>
      <dd className="flex items-center gap-2">
        {detail.length ? <span className="ac-mono text-micro text-text-3">{detail.join(' · ')}</span> : null}
        <span className="ac-mono text-micro text-text-2">{block?.surface ?? fallback}</span>
        {block?.surface ? null : <Badge tone="neutral">default</Badge>}
      </dd>
    </div>
  );
}

export function SecuritySection(): React.ReactElement {
  const me = useMe();
  const sessions = useAuthSessions();
  const qc = useQueryClient();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [code, setCode] = useState('');
  const [pendingRevoke, setPendingRevoke] = useState<Set<string>>(new Set());

  const revoke = (id: string): void => {
    // 5 s undo before the request actually goes out.
    setPendingRevoke((s) => new Set(s).add(id));
    const timer = setTimeout(() => {
      void api.root(`/auth/sessions/${id}`, { method: 'DELETE' }).then(() => qc.invalidateQueries({ queryKey: qk.sessions() }));
      setPendingRevoke((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }, 5000);
    toast.push({
      title: 'Device revoked',
      detail: 'It will be signed out in 5 seconds.',
      status: 'failed',
      ttl: 5000,
      undo: {
        label: 'Undo',
        run: () => {
          clearTimeout(timer);
          setPendingRevoke((s) => {
            const n = new Set(s);
            n.delete(id);
            return n;
          });
        },
      },
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <section>
        <div className="ac-label mb-2">Change password</div>
        <Field label="Current password">
          <input type="password" className={inputCx} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </Field>
        <Field label="New password">
          <input type="password" className={inputCx} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </Field>
        <Button
          variant="primary"
          disabled={!current || next.length < 8}
          onClick={() =>
            void api
              .root('/auth/password', { method: 'POST', body: { current, next } })
              .then(() => {
                toast.push({ title: 'Password changed', status: 'done' });
                setCurrent('');
                setNext('');
              })
              .catch((e: Error) => toast.push({ title: 'Could not change the password', detail: e.message, status: 'failed' }))
          }
        >
          Change password
        </Button>
      </section>

      <section>
        <div className="ac-label mb-2">Two-factor authentication</div>
        {me.data?.totpEnabled ? (
          <div className="flex items-center gap-3">
            <Badge tone="added">enabled</Badge>
            <Button
              variant="danger"
              size="sm"
              onClick={() =>
                void api
                  .root('/auth/totp/disable', { method: 'POST', body: { password: current } })
                  .then(() => qc.invalidateQueries({ queryKey: qk.me() }))
                  .catch((e: Error) => toast.push({ title: 'Could not disable TOTP', detail: e.message, status: 'failed' }))
              }
            >
              Disable
            </Button>
            <span className="text-micro text-text-3">Enter your current password above first.</span>
          </div>
        ) : setup ? (
          <div className="flex flex-col gap-3 sm:flex-row">
            <QR text={setup.otpauthUrl} />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div>
                <div className="ac-label mb-1">Secret</div>
                <code className="ac-mono block break-all rounded-r4 border border-line-1 bg-bg-2 px-2 py-1.5 text-micro text-text-1">{setup.secret}</code>
                <p className="mt-1 break-all text-nano text-text-4">{setup.otpauthUrl}</p>
              </div>
              <div>
                <div className="ac-label mb-1.5">Confirm the six digits</div>
                <TOTPInput
                  value={code}
                  onChange={setCode}
                  onComplete={(c) =>
                    void api
                      .root('/auth/totp/enable', { method: 'POST', body: { code: c } })
                      .then(() => {
                        toast.push({ title: 'Two-factor enabled', status: 'done' });
                        setSetup(null);
                        void qc.invalidateQueries({ queryKey: qk.me() });
                      })
                      .catch(() => toast.push({ title: 'That code did not verify', status: 'failed' }))
                  }
                />
              </div>
              <div>
                <div className="ac-label mb-1.5">Recovery codes — store these now</div>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {setup.recoveryCodes.map((c) => (
                    <code key={c} className="ac-mono rounded-r4 border border-line-1 bg-bg-2 px-2 py-1 text-micro text-text-soft">
                      {c}
                    </code>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <Button
            onClick={() =>
              void api
                .root<TotpSetup>('/auth/totp/setup', { method: 'POST', body: {} })
                .then(setSetup)
                .catch((e: Error) => toast.push({ title: 'Could not start TOTP setup', detail: e.message, status: 'failed' }))
            }
          >
            Set up two-factor
          </Button>
        )}
      </section>

      <section>
        <div className="ac-label mb-2">Devices</div>
        {sessions.isLoading ? (
          <SkeletonRows rows={3} />
        ) : (
          <div className="ac-card overflow-hidden">
            {(sessions.data ?? [])
              .filter((s) => !pendingRevoke.has(s.id))
              .map((s) => (
                <DeviceRow key={s.id} session={s} current={s.current ?? s.id === me.data?.session.id} onRevoke={revoke} />
              ))}
          </div>
        )}
        <Button
          className="mt-3"
          variant="danger"
          size="sm"
          onClick={() =>
            void api.root('/auth/sessions', { method: 'DELETE' }).then(() => {
              setToken(null, false);
              void qc.invalidateQueries({ queryKey: qk.sessions() });
            })
          }
        >
          Sign out every other device
        </Button>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------- device
 * Neither the daemon's nor the workspace's: the theme and the notification preferences live in this
 * browser's localStorage, so they follow the device and not the account. The section says so, which
 * is what keeps the page at two areas without filing per-device state under either of them.
 */

/** `wired: false` means nothing calls `sendPush` for this category yet — the toggle still saves its
 * state (so turning it on costs nothing and is forward-compatible), it just says so honestly. */
const NOTIFS = [
  { key: 'decisions', label: 'Decisions', detail: 'Plans, merges, hires, worker questions', def: true, wired: true },
  { key: 'landed', label: 'Landed work', detail: 'A PR merged, a ticket closed', def: true, wired: false },
  { key: 'everything', label: 'Everything else', detail: 'Status changes, run starts, curation', def: false, wired: false },
] as const;

export function DictationSection(): React.ReactElement {
  const tx = useTranscription();
  const put = useSetTranscription();
  const backend = tx.data?.backend ?? 'chrome';
  const installed = Boolean(tx.data?.voxtype.installed);
  const models = (tx.data?.voxtype.models ?? []).filter((m) => m.installed);
  const model = tx.data?.model ?? models[0]?.id ?? '';
  const autoSend = useDictationAutoSend();

  return (
    <section className="flex flex-col gap-4">
      <p className="text-meta leading-relaxed text-text-2">
        Chrome uses this browser&apos;s speech service (the default). Voxtype transcribes on the daemon host — audio is recorded here and sent as a WAV when you stop.
      </p>
      <div className="ac-card divide-y divide-line-1">
        <div className="flex flex-col gap-2 px-3.5 py-3">
          <span className="text-meta text-text-1">Backend</span>
          <Segmented
            ariaLabel="Dictation backend"
            options={[{ value: 'chrome', label: 'Chrome' }, { value: 'voxtype', label: 'Voxtype' }]}
            value={backend}
            onChange={(v) => {
              if (v === 'voxtype' && !installed) return;
              put.mutate({ backend: v, ...(v === 'voxtype' && model ? { model } : {}) });
            }}
          />
          {!installed ? (
            <span className="text-micro text-text-3">Voxtype is not installed on the daemon host. Chrome dictation still works.</span>
          ) : null}
        </div>
        {backend === 'voxtype' && installed && models.length > 0 ? (
          <div className="px-3.5 py-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-meta text-text-1">Model</span>
              <select
                className={cx(inputCx, 'ac-mono')}
                aria-label="Voxtype model"
                value={model}
                onChange={(e) => put.mutate({ backend: 'voxtype', model: e.target.value })}
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.id}</option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        {backend === 'voxtype' && installed && models.length === 0 ? (
          <p className="px-3.5 py-3 text-micro text-text-3">No Voxtype model is installed on the host.</p>
        ) : null}
      </div>

      <div className="ac-card">
        <label className="flex items-center gap-3 px-3.5 py-3">
          <span className="min-w-0 flex-1">
            <span className="block text-meta text-text-1">Send automatically when dictation ends</span>
            <span className="block text-micro text-text-3">
              When on, ending a dictation with the keyboard shortcut sends the whole draft once the transcript lands — as if you pressed send. The mic and Stop always leave the text in the composer. Stored in this browser, not on the daemon.
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={autoSend}
            aria-label="Send automatically when dictation ends"
            onClick={() => writeDictationAutoSend(!autoSend)}
            className={cx(
              'flex h-5 w-9 flex-none items-center rounded-pill border px-0.5 transition-colors duration-(--dur-fast) ease-ac',
              autoSend ? 'justify-end border-accent bg-accent' : 'justify-start border-line-2 bg-bg-3',
            )}
          >
            <span className={cx('size-3.5 rounded-pill', autoSend ? 'bg-accent-on' : 'bg-text-nav')} />
          </button>
        </label>
      </div>
    </section>
  );
}

/** The text-size preview's real exchange — a user question and a weaver reply, at the current size. */
const TEXT_SIZE_PREVIEW_USER =
  'Could the chat text be a size I choose? I read it for long stretches and the default feels a little tight.';
const TEXT_SIZE_PREVIEW_WEAVER =
  'Done — there is a text-size control under Settings → This device. Pick a step and this preview, like the rest of the app, resizes with it.';
const noopTicket = (): void => {};

/**
 * The device text-size preference (VS-551): the bounded ladder, and a preview built from the real
 * message components so the choice is judged on real message-shaped text, not a lorem block.
 */
export function TextSizeSection(): React.ReactElement {
  const { size: textSize, setSize: setTextSize } = useTextSize();
  return (
    <section>
      <div className="ac-label mb-2">Text size</div>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:gap-4">
        <div className="md:w-44 md:flex-none">
          <div className="flex flex-wrap gap-1.5">
            {TEXT_SIZE_STEPS.map((step) => (
              <button
                key={step.key}
                type="button"
                aria-pressed={textSize === step.key}
                onClick={() => setTextSize(step.key)}
                className={cx(
                  'rounded-r6 border px-2.5 py-1.5 text-meta',
                  textSize === step.key ? 'border-accent-edge bg-accent-tint text-accent-link' : 'border-line-2 text-text-3',
                )}
              >
                {step.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-micro text-text-3">
            Applies to every page in this browser, the weaver chat included. Default matches today&apos;s size.
          </p>
        </div>
        <div className="min-w-0 flex-1 rounded-r6 border border-line-1 bg-bg-0 p-3" data-text-size-preview>
          <div className="flex flex-col gap-2">
            <div className="flex justify-end">
              <MessageBubble mine>
                <MessageBody body={TEXT_SIZE_PREVIEW_USER} onTicket={noopTicket} />
              </MessageBubble>
            </div>
            <MessageBubble mine={false}>
              <MessageBody body={TEXT_SIZE_PREVIEW_WEAVER} onTicket={noopTicket} />
            </MessageBubble>
          </div>
        </div>
      </div>
    </section>
  );
}

export function DeviceSection({ themeControl = 'full' }: { themeControl?: 'full' | 'note' } = {}): React.ReactElement {
  // Push subscriptions are registered per workspace — the daemon's push routes live under
  // `/api/w/:ws`, and the subscription id is remembered per workspace in localStorage — so the
  // controls address the workspace this browser remembers, which is where an existing subscription
  // already lives. The daemon settings page is reached without a workspace (VS-230), so the
  // context may be empty.
  const ctxWs = useHookWs();
  const ws = ctxWs || getWorkspaceId() || '';
  const toast = useToast();
  const [theme, setTheme] = useTheme();
  const [state, setState] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('conductor.notifs') ?? '') as Record<string, boolean>;
    } catch {
      return Object.fromEntries(NOTIFS.map((n) => [n.key, n.def]));
    }
  });
  const [enabled, setEnabled] = useState(() => ws !== '' && subscriptionId(ws) !== null);
  const [busy, setBusy] = useState(false);
  // The chat reads this through `useShowSilentTurns`; the writer publishes, so a chat already
  // mounted behind this page follows without a reload.
  const [silentTurns, setSilentTurns] = useState(readShowSilentTurns);
  // VS-616: the same for the weaver chat's streamed text and mid-turn tool trace, also off by default.
  const showLiveRunOutput = useShowLiveRunOutput();
  const dictationDiagnostics = useDictationDiagnosticsEnabled();

  /** Every category currently toggled on, in the shape the subscription stores it. */
  const activeCategories = (s: Record<string, boolean>): PushCategory[] => NOTIFS.filter((n) => s[n.key] ?? n.def).map((n) => n.key);

  const save = (key: string, on: boolean): void => {
    const next = { ...state, [key]: on };
    setState(next);
    try {
      localStorage.setItem('conductor.notifs', JSON.stringify(next));
    } catch {
      /* private mode */
    }
    // Already subscribed: push the new selection to the daemon so delivery is filtered by it —
    // no unsubscribe/resubscribe round trip needed (`updatePushCategories` upserts in place).
    if (enabled && ws !== '') void updatePushCategories(ws, activeCategories(next));
  };

  /** Whatever went wrong — a blocked permission, a daemon without VAPID keys — the human reads it. */
  const run = (what: 'on' | 'off'): void => {
    setBusy(true);
    const done = what === 'on' ? enablePush(ws, activeCategories(state)) : disablePush(ws);
    done
      .then(() => {
        setEnabled(what === 'on');
        toast.push(
          what === 'on'
            ? { title: 'Push enabled', detail: 'Decisions and landed work will reach this device.', status: 'done' }
            : { title: 'Push turned off for this device', status: 'done' },
        );
      })
      .catch((e: Error) =>
        toast.push({ title: what === 'on' ? 'Could not enable push' : 'Could not turn push off', detail: e.message, status: 'failed', ttl: 8000 }),
      )
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="text-meta leading-relaxed text-text-2">
        These are stored in this browser only — not on the daemon and not in any workspace. Another device signed in to the
        same account has its own.
      </p>

      <section>
        <div className="ac-label mb-2">Theme</div>
        {themeControl === 'note' ? (
          <p className="text-micro text-text-3">Theme follows the in-app switch — the rail footer on desktop, the More menu on a phone.</p>
        ) : (
          <>
            <div className="flex gap-1.5">
              {(['dark', 'light', 'system'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTheme(t)}
                  className={cx('rounded-r6 border px-3 py-1.5 text-meta', theme === t ? 'border-accent-edge bg-accent-tint text-accent-link' : 'border-line-2 text-text-3')}
                >
                  {t}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-micro text-text-3">Dark is the designed theme; light is authored from the same tokens.</p>
          </>
        )}
      </section>

      <TextSizeSection />

      <section>
        <div className="ac-label mb-2">Chat</div>
        <div className="ac-card">
          <label className="flex items-center gap-3 px-3.5 py-3">
            <span className="min-w-0 flex-1">
              <span className="block text-meta text-text-1">Turns with no reply</span>
              <span className="block text-micro text-text-3">A row for work the weaver did without saying anything — a wake that only filed a ticket.</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={silentTurns}
              aria-label="Turns with no reply"
              onClick={() => { setSilentTurns(!silentTurns); writeShowSilentTurns(!silentTurns); }}
              className={cx(
                'flex h-5 w-9 flex-none items-center rounded-pill border px-0.5 transition-colors duration-(--dur-fast) ease-ac',
                silentTurns ? 'justify-end border-accent bg-accent' : 'justify-start border-line-2 bg-bg-3',
              )}
            >
              <span className={cx('size-3.5 rounded-pill', silentTurns ? 'bg-accent-on' : 'bg-text-nav')} />
            </button>
          </label>
        </div>
        <div className="ac-card mt-2">
          <label className="flex items-center gap-3 px-3.5 py-3">
            <span className="min-w-0 flex-1">
              <span className="block text-meta text-text-1">Live weaver output</span>
              <span className="block text-micro text-text-3">
                Show the weaver&apos;s words and tool calls as they stream, in a marked in-progress section that clears when its
                real message arrives. Off, the chat shows only what the weaver has sent plus the activity row. Stored in this
                browser, not on the daemon.
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={showLiveRunOutput}
              aria-label="Live weaver output"
              onClick={() => writeShowLiveRunOutput(!showLiveRunOutput)}
              className={cx(
                'flex h-5 w-9 flex-none items-center rounded-pill border px-0.5 transition-colors duration-(--dur-fast) ease-ac',
                showLiveRunOutput ? 'justify-end border-accent bg-accent' : 'justify-start border-line-2 bg-bg-3',
              )}
            >
              <span className={cx('size-3.5 rounded-pill', showLiveRunOutput ? 'bg-accent-on' : 'bg-text-nav')} />
            </button>
          </label>
        </div>
      </section>

      <section>
        <div className="ac-label mb-2">Dictation</div>
        <div className="ac-card">
          <label className="flex items-center gap-3 px-3.5 py-3">
            <span className="min-w-0 flex-1">
              <span className="block text-meta text-text-1">Diagnostics capture</span>
              <span className="block text-micro text-text-3">
                Records the raw recognizer events from your next dictation so a duplication bug can be diagnosed from what actually happened,
                not a guess. Nothing leaves this device unless you copy it from the composer yourself.
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={dictationDiagnostics}
              aria-label="Dictation diagnostics capture"
              onClick={() => writeDictationDiagnosticsEnabled(!dictationDiagnostics)}
              className={cx(
                'flex h-5 w-9 flex-none items-center rounded-pill border px-0.5 transition-colors duration-(--dur-fast) ease-ac',
                dictationDiagnostics ? 'justify-end border-accent bg-accent' : 'justify-start border-line-2 bg-bg-3',
              )}
            >
              <span className={cx('size-3.5 rounded-pill', dictationDiagnostics ? 'bg-accent-on' : 'bg-text-nav')} />
            </button>
          </label>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div className="ac-label">Notifications</div>
        <p className="text-meta leading-relaxed text-text-2">
          In-app arrival is the primary path — a toast plus the Needs-you badge — and nothing in any flow depends on a push being delivered.
        </p>
        <div className="ac-card divide-y divide-line-1">
          {NOTIFS.map((n) => (
            <label key={n.key} className="flex items-center gap-3 px-3.5 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-meta text-text-1">{n.label}</span>
                <span className="block text-micro text-text-3">
                  {n.detail}
                  {n.wired ? null : ' — not sent yet'}
                </span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={state[n.key] ?? n.def}
                aria-label={n.label}
                onClick={() => save(n.key, !(state[n.key] ?? n.def))}
                className={cx(
                  'flex h-5 w-9 flex-none items-center rounded-pill border px-0.5 transition-colors duration-(--dur-fast) ease-ac',
                  state[n.key] ?? n.def ? 'justify-end border-accent bg-accent' : 'justify-start border-line-2 bg-bg-3',
                )}
              >
                <span className={cx('size-3.5 rounded-pill', state[n.key] ?? n.def ? 'bg-accent-on' : 'bg-text-nav')} />
              </button>
            </label>
          ))}
        </div>
        {ws === '' ? (
          <p className="text-micro text-text-3">
            Push is registered per workspace. Open a workspace of this daemon once, then return here to turn push on.
          </p>
        ) : enabled ? (
          <div className="flex items-center gap-3">
            <p className="min-w-0 flex-1 text-micro text-text-3">Push is on for this device.</p>
            <Button disabled={busy} onClick={() => run('off')}>
              Turn off on this device
            </Button>
          </div>
        ) : (
          <Button disabled={busy} onClick={() => run('on')}>
            Get notified when something needs you
          </Button>
        )}
      </section>
    </div>
  );
}


/* ------------------------------------------------------------------ updates
 * The daemon's own release: what it is running, whether the source it builds from is ahead, and the
 * deferred upgrade — which waits for every running turn to finish before it touches anything, and
 * restarts the daemon this app is talking to. See PLAN §20.
 */

export function UpdatesSection(): React.ReactElement {
  const update = useDaemonUpdate();
  const status = useDaemonUpgrade();
  const refresh = useRefreshDaemonUpdate();
  const request = useRequestUpgrade();
  const cancel = useCancelUpgrade();
  const toast = useToast();

  if (update.isLoading) return <SkeletonRows rows={3} />;
  if (update.isError && !update.data) return <ErrorState message="Could not read the daemon's update state." onRetry={() => void update.refetch()} />;

  const data = update.data;
  const upgrade = status.data?.upgrade ?? null;
  const pending = inFlight(upgrade);

  return (
    <div className="flex flex-col gap-5">
      <section>
        <div className="ac-label mb-2">This daemon</div>
        <div className="ac-card divide-y divide-line-1">
          <Row label="Version" value={runningVersionLabel(data?.running.version, data?.running.path)} />
          <Row label="Commit" value={shortSha(data?.running.sha)} mono />
          <Row label="Release" value={data?.running.path ?? '—'} mono />
        </div>
      </section>

      <section>
        <div className="ac-label mb-2">Release source</div>
        {!data?.configured ? (
          <EmptyState
            title="Update checking is not configured"
            detail="Set upgrade.source (a git URL or a local checkout) in the daemon's daemon.yaml, and optionally upgrade.ref."
          />
        ) : (
          <>
            <div className="ac-card divide-y divide-line-1">
              <Row label="Source" value={`${data.source} @ ${data.ref}`} mono />
              <Row label="Target" value={shortSha(data.targetSha)} mono />
              <Row label="Checked" value={data.checkedAt ?? '—'} />
              {data.error ? <Row label="Error" value={data.error} tone="failed" /> : null}
            </div>
            <div className="mt-3 flex items-center gap-2">
              {data.updateAvailable && !data.error ? (
                <Badge tone="accent">Update available</Badge>
              ) : data.error ? null : (
                <span className="text-meta text-text-3">Up to date</span>
              )}
              <div className="flex-1" />
              <Button onClick={() => refresh.mutate()} disabled={refresh.isPending}>
                {refresh.isPending ? 'Checking…' : 'Check again'}
              </Button>
              {data.updateAvailable && !data.error && !pending ? (
                <Button
                  variant="primary"
                  disabled={request.isPending}
                  onClick={() =>
                    request.mutate(undefined, {
                      onSuccess: () => toast.push({ title: 'Upgrade queued', detail: 'It starts once no turn is running.', status: 'merging', ttl: 6000 }),
                      onError: (e) => toast.push({ title: 'Could not queue the upgrade', detail: e.message, status: 'failed', ttl: 8000 }),
                    })
                  }
                >
                  {request.isPending ? 'Queueing…' : 'Upgrade'}
                </Button>
              ) : null}
            </div>
          </>
        )}
      </section>

      {upgrade ? <UpgradeProgress upgrade={upgrade} waitingFor={status.data?.waitingFor ?? []} unreachable={status.isError} onCancel={() => cancel.mutate()} cancelling={cancel.isPending} runningVersion={data?.running.version ?? null} /> : null}
    </div>
  );
}

function Row({ label, value, mono, tone }: { label: string; value: string; mono?: boolean; tone?: 'failed' }): React.ReactElement {
  return (
    <div className="flex items-baseline gap-3 px-3.5 py-2.5">
      <span className="ac-label w-28 flex-none">{label}</span>
      <span className={cx('min-w-0 flex-1 break-all text-meta', mono ? 'ac-mono' : '', tone === 'failed' ? 'text-failed' : 'text-text-2')}>{value}</span>
    </div>
  );
}

function UpgradeProgress({
  upgrade, waitingFor, unreachable, onCancel, cancelling, runningVersion,
}: {
  upgrade: NonNullable<ReturnType<typeof useDaemonUpgrade>['data']>['upgrade'];
  waitingFor: Array<{ workspace: string; running: number; runIds: string[] }>;
  unreachable: boolean;
  onCancel: () => void;
  cancelling: boolean;
  runningVersion: string | null;
}): React.ReactElement | null {
  if (!upgrade) return null;
  const pending = inFlight(upgrade);
  // While the daemon restarts the poll fails; that is the restart, not an error.
  const restarting = isRestarting(upgrade.state) || (pending && unreachable);

  return (
    <section>
      <div className="ac-label mb-2">Upgrade</div>
      <div className="ac-card divide-y divide-line-1">
        <div className="flex items-center gap-3 px-3.5 py-2.5">
          <span className="flex-1 text-body text-text-1">
            {restarting ? 'Restarting the daemon…' : UPGRADE_STAGE_LABEL[upgrade.state]}
          </span>
          {pending ? <Badge tone="accent">{upgrade.state}</Badge> : null}
          {upgrade.state === 'completed' ? <Badge tone="added">completed</Badge> : null}
          {upgrade.state === 'failed' ? <Badge tone="removed">failed</Badge> : null}
        </div>

        {restarting ? (
          <div className="px-3.5 py-2.5 text-meta text-text-3">
            Waiting for the daemon to answer again. This page reconnects on its own.
          </div>
        ) : null}

        {upgrade.state === 'waiting' && waitingFor.length ? (
          <div className="px-3.5 py-2.5 text-meta text-text-2">
            Waiting for{' '}
            {waitingFor.map((w) => `${w.running} run${w.running === 1 ? '' : 's'} in ${w.workspace}`).join(', ')}. No new run starts until the upgrade finishes or is cancelled.
          </div>
        ) : null}

        <Row label="Target" value={`${upgrade.source} @ ${upgrade.ref} · ${shortSha(upgrade.toSha ?? upgrade.targetSha)}`} mono />
        {upgrade.state === 'completed' ? <Row label="Now running" value={runningVersionLabel(upgrade.cameBackVersion ?? runningVersion)} /> : null}
        {upgrade.state === 'failed' ? <Row label="Reason" value={upgrade.reason ?? 'unknown'} tone="failed" /> : null}
        {upgrade.state === 'failed' ? <Row label="Still running" value={runningVersionLabel(runningVersion)} /> : null}
        {upgrade.message ? <Row label="Detail" value={upgrade.message} tone={upgrade.state === 'failed' ? 'failed' : undefined} /> : null}

        {upgrade.log.length ? (
          <pre className="ac-mono max-h-56 overflow-auto px-3.5 py-2.5 text-micro text-text-3">{upgrade.log.join('\n')}</pre>
        ) : null}
      </div>

      {isCancellableUpgrade(upgrade.state) ? (
        <div className="mt-3 flex justify-end">
          <Button onClick={onCancel} disabled={cancelling}>{cancelling ? 'Cancelling…' : 'Cancel upgrade'}</Button>
        </div>
      ) : null}
    </section>
  );
}
