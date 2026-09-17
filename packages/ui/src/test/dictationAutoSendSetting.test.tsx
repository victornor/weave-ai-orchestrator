/**
 * The restored Settings → Dictation switch for "Send automatically when dictation ends" (VS-494,
 * restoring VS-435). It is the only UI for the preference the dictation keybinding now honours.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/hooks')>();
  return {
    ...actual,
    useTranscription: () => ({ data: { backend: 'chrome', voxtype: { installed: false, models: [] } } }),
    useSetTranscription: () => ({ mutate: vi.fn() }),
  };
});

const { DictationSection } = await import('../settings/sections');

const KEY = 'conductor.dictationAutoSend';
const LABEL = 'Send automatically when dictation ends';

describe('Settings → Dictation: send automatically when dictation ends (VS-494)', () => {
  beforeEach(() => localStorage.removeItem(KEY));
  afterEach(() => localStorage.removeItem(KEY));

  it('renders off by default, toggles on, and stores the preference', () => {
    render(<DictationSection />);
    const sw = screen.getByRole('switch', { name: LABEL });
    expect(sw).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(sw);
    expect(localStorage.getItem(KEY)).toBe('on');
    expect(screen.getByRole('switch', { name: LABEL })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('switch', { name: LABEL }));
    expect(localStorage.getItem(KEY)).toBe('off');
    expect(screen.getByRole('switch', { name: LABEL })).toHaveAttribute('aria-checked', 'false');
  });

  it('reads a preference stored before the setting was retired', () => {
    localStorage.setItem(KEY, 'on');
    render(<DictationSection />);
    expect(screen.getByRole('switch', { name: LABEL })).toHaveAttribute('aria-checked', 'true');
  });
});
