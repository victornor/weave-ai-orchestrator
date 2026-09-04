/** OSC window title: surfaces read it to name panes and windows (PLAN §14b.3). */
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const CONTROL = new RegExp('[\\u0000-\\u001F\\u007F]', 'g');

export function setTerminalTitle(title: string): void {
  if (!process.stdout.isTTY) return;
  const clean = title.replace(CONTROL, ' ').slice(0, 160);
  process.stdout.write(`${ESC}]0;${clean}${BEL}`);
}

export function clearTerminalTitle(): void {
  setTerminalTitle('');
}
