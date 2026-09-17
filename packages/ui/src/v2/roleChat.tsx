/**
 * VS-525: the one control that opens a role's persistent session, shared by the project overview's
 * Roles section and the V2 Roles screen so the two surfaces cannot disagree about what the thing is
 * called or when it is offered. The opening call is the same `usePersistentSession` open-or-resume
 * the Roles page used before this change — this module is not a second implementation of it.
 *
 * The pure helpers (`roleChatActionLabel`, `roleChatStateLabel`, `roleChatBlockedReason`,
 * `sessionForRole`) are exported so the states are testable without a browser, the pattern
 * `RolesPage.tsx` already uses for its own helpers.
 */
import type { Agent, Role } from '@weave-ai/shared';
import { useGo } from '../app/link';
import { usePersistentSession } from '../api/hooks';
import { messageOf } from '../components/States';
import { cx } from '../lib/cx';
import { statusText } from '../lib/format';

/** The action the control offers: opening an existing conversation, or starting a new one. */
export function roleChatActionLabel(hasSession: boolean): string {
  return hasSession ? 'Open chat' : 'Start chat';
}

/** What the control says about the session's existence, beside or in the action. */
export function roleChatStateLabel(hasSession: boolean): string {
  return hasSession ? 'Conversation ready' : 'No conversation yet';
}

/**
 * Why a role cannot serve a persistent session, or `null` when it can. A role is only offered a chat
 * while it is `active`: a paused, retired or not-yet-hired role cannot serve one, so the surfaces
 * state the reason rather than presenting a control that fails on click (VS-525).
 */
export function roleChatBlockedReason(role: Pick<Role, 'status'>): string | null {
  switch (role.status) {
    case 'active':
      return null;
    case 'paused':
      return 'Paused — resume the role to chat';
    case 'retired':
      return 'Retired — no longer available to chat';
    case 'pending_activation':
      return 'Awaiting hire approval — no chat yet';
    default:
      return `${statusText(role.status)} — no chat`;
  }
}

/** The role's live persistent session in a list of session agents, or `null` when it has none yet. */
export function sessionForRole(sessions: readonly Agent[], roleId: string): Agent | null {
  return sessions.find((s) => s.kind === 'session' && s.roleId === roleId) ?? null;
}

/**
 * The button (or the reason there is none) that opens `role`'s persistent session. It owns the
 * open-or-resume mutation and the navigation to the session's worker page; the page owns the read
 * that says whether the session already exists.
 */
export function RoleChatControl({
  role,
  session,
  ws,
  workerModelId,
  className,
}: {
  role: Pick<Role, 'id' | 'projectId' | 'name' | 'status'>;
  session: Agent | null;
  ws: string;
  /** VS-526: the worker option a newly created session runs on; omitted leaves the `workers` setting. */
  workerModelId?: string;
  className?: string;
}): React.ReactElement {
  const go = useGo();
  const persistentSession = usePersistentSession();

  const blocked = roleChatBlockedReason(role);
  if (blocked) {
    return <span className={cx('text-micro text-text-3', className)}>{blocked}</span>;
  }

  const onOpen = (): void => {
    persistentSession.mutate(
      { projectId: role.projectId, roleId: role.id, ...(workerModelId ? { workerModelId } : {}) },
      { onSuccess: ({ agent }) => go('/w/$ws/workers/$workerId', { params: { ws, workerId: agent.id } }) },
    );
  };

  return (
    <span className={cx('inline-flex flex-col items-start gap-0.5', className)}>
      <button
        type="button"
        disabled={persistentSession.isPending}
        title={roleChatStateLabel(session !== null)}
        onClick={onOpen}
        className="flex-none text-micro text-accent-link hover:text-text-1 disabled:opacity-40"
      >
        {roleChatActionLabel(session !== null)}
      </button>
      {persistentSession.isError ? (
        <span role="status" className="text-nano text-blocked">
          The chat was not opened: {messageOf(persistentSession.error)}
        </span>
      ) : null}
    </span>
  );
}
