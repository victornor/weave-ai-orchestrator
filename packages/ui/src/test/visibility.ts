/** jsdom's `document.visibilityState` is not writable; tests drive VS-227 hide/show this way. */
export function setDocumentHidden(hidden: boolean): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

export function resetDocumentVisible(): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  });
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => false,
  });
}
