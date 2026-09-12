/**
 * `@weave-ai/tui` — the Ink apps behind `weave chat`, `weave attach`, `weave top` and `weave specs explore`
 * (PLAN §21.2). Every app is a thin client over the same REST + SSE API and renders the view models
 * from `@weave-ai/render`, so the terminal and the web never drift.
 */
import React from 'react';
import { render } from 'ink';
import { Chat, type ChatOptions } from './apps/Chat.js';
import { Attach } from './apps/Attach.js';
import { Top } from './apps/Top.js';
import { Specs } from './apps/Specs.js';
import { clearTerminalTitle } from './terminal.js';
import type { TuiClient } from './client.js';

export const PACKAGE = '@weave-ai/tui';

export type { TuiClient, TuiSseMessage, TuiStreamOptions, TuiSubscription } from './client.js';
export type { ChatOptions } from './apps/Chat.js';
export { Chat, Attach, Top, Specs };
export { setTerminalTitle, clearTerminalTitle } from './terminal.js';

async function mount(element: React.ReactElement): Promise<void> {
  const instance = render(element, { exitOnCtrlC: true });
  try {
    await instance.waitUntilExit();
  } finally {
    clearTerminalTitle();
  }
}

export function runChat(client: TuiClient, options: ChatOptions = {}): Promise<void> {
  return mount(React.createElement(Chat, { client, options }));
}

export function runAttach(client: TuiClient, agentId: string): Promise<void> {
  return mount(React.createElement(Attach, { client, agentId }));
}

export function runTop(client: TuiClient): Promise<void> {
  return mount(React.createElement(Top, { client }));
}

export function runSpecs(client: TuiClient, projectId: string): Promise<void> {
  return mount(React.createElement(Specs, { client, projectId }));
}
