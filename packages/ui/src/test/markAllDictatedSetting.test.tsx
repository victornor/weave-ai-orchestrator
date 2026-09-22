/**
 * Settings → Dictation: "Mark all my messages as voice dictated" (VS-657). A device-local habit for a
 * human who dictates everything, so a typed message still carries the note that misspellings are
 * likely. Off by default.
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

const KEY = 'conductor.markAllDictated';
const LABEL = 'Mark all my messages as voice dictated';

describe('Settings → Dictation: mark all my messages as voice dictated (VS-657)', () => {
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

  it('reads a preference stored earlier', () => {
    localStorage.setItem(KEY, 'on');
    render(<DictationSection />);
    expect(screen.getByRole('switch', { name: LABEL })).toHaveAttribute('aria-checked', 'true');
  });
});
