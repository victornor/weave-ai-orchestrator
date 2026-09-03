/** Conservative token estimate: ceil(bytes/3.5). Portable, no tokenizer. */
export function estimateTokens(text: string): number { return Math.ceil(Buffer.byteLength(text, 'utf8') / 3.5); }
