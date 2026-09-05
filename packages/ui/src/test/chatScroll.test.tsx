/** Per-workspace chat reading position (`lib/chatScroll.ts`) — VS-46. */
import { beforeEach, describe, expect, it } from 'vitest';
import { clearChatScroll, readChatScroll, writeChatScroll } from '../lib/chatScroll';

beforeEach(() => {
  clearChatScroll('alpha');
  clearChatScroll('beta');
});

describe('recording a position', () => {
  it('has nothing to restore before a chat has been left', () => {
    expect(readChatScroll('alpha')).toBeNull();
  });

  it('keeps a position the human scrolled to', () => {
    writeChatScroll('alpha', 420, false);
    expect(readChatScroll('alpha')).toBe(420);
  });

  it('records nothing for a chat left at its newest message', () => {
    writeChatScroll('alpha', 980, true);
    expect(readChatScroll('alpha')).toBeNull();
  });

  it('forgets an earlier position once the chat is left at the bottom', () => {
    writeChatScroll('alpha', 420, false);
    writeChatScroll('alpha', 980, true);
    expect(readChatScroll('alpha')).toBeNull();
  });
});

describe('keeping workspaces apart', () => {
  it('holds a separate position per workspace', () => {
    writeChatScroll('alpha', 420, false);
    writeChatScroll('beta', 130, false);
    expect(readChatScroll('alpha')).toBe(420);
    expect(readChatScroll('beta')).toBe(130);
  });

  it('leaves the others alone when one is cleared', () => {
    writeChatScroll('alpha', 420, false);
    writeChatScroll('beta', 130, false);
    clearChatScroll('alpha');
    expect(readChatScroll('alpha')).toBeNull();
    expect(readChatScroll('beta')).toBe(130);
  });
});
