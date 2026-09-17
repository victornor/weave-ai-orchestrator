import { statusText } from './format';

/** The human-facing name for a role's status; `pending_activation` reads "awaiting hire approval". */
export function roleStateLabel(status: string): string {
  switch (status) {
    case 'pending_activation':
      return 'awaiting hire approval';
    case 'active':
      return 'active';
    case 'paused':
      return 'paused';
    case 'retired':
      return 'retired';
    default:
      return statusText(status);
  }
}
