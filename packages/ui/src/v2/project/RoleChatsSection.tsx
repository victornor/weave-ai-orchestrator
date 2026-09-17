/**
 * VS-525: the V2 project overview's Roles section, immediately below Roadmap — the project's hired
 * roles, each with the shared role-chat control that opens its persistent session. This is the
 * second door to a role's persistent session; the V2 Roles screen's own control remains.
 *
 * The section reads only its own data (the project's roles and their session agents), so a project
 * with no roles says so rather than showing an empty list.
 */
import { A } from '../../app/link';
import { useRoles, useSessions } from '../../api/hooks';
import { SkeletonRows } from '../../components/Skeleton';
import { EmptyState } from '../../components/States';
import { cx } from '../../lib/cx';
import { roleStateLabel } from '../../lib/roleState';
import { RoleChatControl, roleChatBlockedReason, roleChatStateLabel, sessionForRole } from '../roleChat';
import type { V2ProjectSectionProps } from './sections';

export function RoleChatsSection({ project, ws }: V2ProjectSectionProps): React.ReactElement {
  const roles = useRoles(project.id);
  const sessions = useSessions(project.id);

  if (roles.isLoading) return <SkeletonRows rows={3} />;

  const list = roles.data ?? [];
  if (list.length === 0) {
    return (
      <EmptyState
        title="No roles hired for this project yet."
        detail={
          <>
            Hire one from the <A to="/w/$ws/roles" params={{ ws }} className="v2-link">Roles</A> screen, then its chat appears here.
          </>
        }
      />
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {list.map((role) => {
        const session = sessionForRole(sessions.data ?? [], role.id);
        const blocked = roleChatBlockedReason(role);
        return (
          <li key={role.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-r4 border border-line-1 px-2.5 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-ui font-medium text-text-1">{role.name}</span>
              {blocked ? null : <span className="ac-mono block text-nano text-text-3">{roleChatStateLabel(session !== null)}</span>}
            </span>
            <span className={cx('v2-tag flex-none', role.status === 'active' ? 'text-text-2' : 'text-text-4')}>{roleStateLabel(role.status)}</span>
            <RoleChatControl role={role} session={session} ws={ws} className="flex-none items-end" />
          </li>
        );
      })}
    </ul>
  );
}
