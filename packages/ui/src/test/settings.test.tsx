import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  patches: [] as Array<Record<string, unknown>>,
  config: {} as Record<string, unknown>,
}));

vi.mock('../api/context', () => ({ useWs: () => 'ws1' }));
vi.mock('../app/link', () => ({ useGo: () => vi.fn() }));
vi.mock('../lib/theme', () => ({ useTheme: () => ['dark', vi.fn()] }));
vi.mock('../components/Toast', () => ({ useToast: () => ({ push: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('../api/hooks', () => ({
  useWorkspaceSummary: () => ({ data: { workspace: { id: 'ws1', name: 'Acme', ticketPrefix: 'ACME' }, config: state.config }, isLoading: false }),
  useWorkspaces: () => ({ data: [] }),
  usePatchConfig: () => ({ mutate: (body: Record<string, unknown>) => state.patches.push(body), isPending: false }),
}));

const { SettingsRoute } = await import('../routes/Settings');

beforeEach(() => {
  state.patches = [];
  state.config = {
    defaults: { bootstrapBudgetTokens: 16000, turnTimeoutSec: 2700, knowledgeBudgetTokens: { workspace: 10000, shared: 2000, decisions: 4000, project: 10000, document: 10000 } },
  };
});

describe('Settings — knowledge budgets', () => {
  it('shows every configured budget', () => {
    render(<SettingsRoute />);
    expect(screen.getByLabelText('Project knowledge base')).toHaveValue(10000);
    expect(screen.getByLabelText('Linked document')).toHaveValue(10000);
    expect(screen.getByLabelText('Shared conventions')).toHaveValue(2000);
    expect(screen.getByLabelText('Decision log')).toHaveValue(4000);
    expect(screen.getByLabelText('Bootstrap digest')).toHaveValue(16000);
  });

  it('patches only the budget that changed', () => {
    render(<SettingsRoute />);
    const input = screen.getByLabelText('Project knowledge base');
    fireEvent.change(input, { target: { value: '25000' } });
    fireEvent.blur(input);
    expect(state.patches).toEqual([{ defaults: { knowledgeBudgetTokens: { project: 25000 } } }]);
  });

  it('says nothing to the daemon when a budget is unchanged or not a sane token count', () => {
    render(<SettingsRoute />);
    const input = screen.getByLabelText('Project knowledge base');
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(state.patches).toEqual([]);
  });
});
