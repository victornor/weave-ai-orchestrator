/**
 * Minimal single-line input. Ink ships no input widget and the TUI must work over SSH, so this
 * handles exactly what a composer needs: printable characters, backspace, word/line kill, history.
 */
import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { useKeys } from '../hooks.js';

export interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  prompt?: string;
  focus?: boolean;
  /** Previously submitted lines, newest last; up/down walk them. */
  history?: string[];
}

export function TextInput({ value, onChange, onSubmit, placeholder = '', prompt = '> ', focus = true, history = [] }: TextInputProps): React.ReactElement {
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);

  useKeys((input, key) => {
    if (!focus) return;
    if (key.return) {
      const trimmed = value.trim();
      setHistoryIndex(null);
      if (trimmed !== '') onSubmit(trimmed);
      return;
    }
    if (key.backspace || key.delete) {
      onChange(value.slice(0, -1));
      return;
    }
    if (key.upArrow && history.length > 0) {
      const next = historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(next);
      onChange(history[next] ?? '');
      return;
    }
    if (key.downArrow && history.length > 0) {
      if (historyIndex === null) return;
      const next = historyIndex + 1;
      if (next >= history.length) { setHistoryIndex(null); onChange(''); return; }
      setHistoryIndex(next);
      onChange(history[next] ?? '');
      return;
    }
    if (key.ctrl && input === 'u') { onChange(''); return; }
    if (key.ctrl && input === 'w') { onChange(value.replace(/\s*\S+\s*$/, '')); return; }
    if (key.ctrl || key.meta || key.escape || key.tab) return;
    if (input) onChange(value + input);
  }, { isActive: focus });

  return (
    <Box>
      <Text color="blueBright">{prompt}</Text>
      {value === '' ? <Text dimColor>{placeholder}</Text> : <Text>{value}</Text>}
      {focus ? <Text inverse> </Text> : null}
    </Box>
  );
}
