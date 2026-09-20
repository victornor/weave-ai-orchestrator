/**
 * `todo_write` (S7): the run's plan list. The model always sends the whole list, so a call replaces
 * the previous one; the list lives for the turn, and the call emits a `plan.proposed` event carrying
 * the items — the same event the codex runtime emits for its todo list, so one rendering serves both.
 */
import { type ToolDefinition } from './index.js';

export interface TodoItem { content: string; status: 'pending' | 'in_progress' | 'completed' }

const STATUSES = ['pending', 'in_progress', 'completed'] as const;

const item = (value: unknown): TodoItem => {
  const o = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const status = STATUSES.find((s) => s === o['status']) ?? 'pending';
  return { content: typeof o['content'] === 'string' ? o['content'] : String(o['content'] ?? ''), status };
};

export function makeTodoTool(): ToolDefinition {
  let items: TodoItem[] = [];
  const count = (s: TodoItem['status']): number => items.filter((t) => t.status === s).length;
  return {
    name: 'todo_write',
    description: 'Replace the todo list for this run with the list given. Send the whole list every time. Use it to track multi-step work.',
    readOnly: true,
    parameters: {
      type: 'object', additionalProperties: false, required: ['todos'],
      properties: {
        todos: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false, required: ['content', 'status'],
            properties: { content: { type: 'string' }, status: { type: 'string', enum: [...STATUSES] } },
          },
        },
      },
    },
    async run(args, ctx) {
      items = (Array.isArray(args['todos']) ? args['todos'] : []).map(item);
      ctx.emit('plan.proposed', { items });
      return { text: `Todo list replaced: ${items.length} item(s) (${count('pending')} pending, ${count('in_progress')} in progress, ${count('completed')} completed).` };
    },
  };
}