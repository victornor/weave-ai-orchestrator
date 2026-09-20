/** The shape of an MCP tool result after the client has folded its content parts. */
export interface McpImagePart { mediaType: string; dataBase64: string }
export interface McpToolResult { text: string; isError: boolean; images?: McpImagePart[] }

/** Every MCP result is capped before it reaches the model: one number, shared by both transports. */
export const MCP_RESULT_MAX_CHARS = 50 * 1024;

export function capMcpResult(text: string): string {
  return text.length > MCP_RESULT_MAX_CHARS ? `${text.slice(0, MCP_RESULT_MAX_CHARS)}\n[truncated at ${MCP_RESULT_MAX_CHARS} characters]` : text;
}

/** Fold MCP content parts into text plus images: text concatenated, images kept, anything else noted as omitted. */
export function foldMcpContent(content: unknown, isError: boolean): McpToolResult {
  const parts = Array.isArray(content) ? (content as Array<Record<string, unknown>>) : [];
  const texts: string[] = [];
  const images: NonNullable<McpToolResult['images']> = [];
  for (const p of parts) {
    const type = p['type'];
    const media = p['mimeType'] ?? p['mediaType'];
    if (type === 'text') texts.push(String(p['text'] ?? ''));
    else if (type === 'image' && typeof p['data'] === 'string' && typeof media === 'string') images.push({ mediaType: String(media), dataBase64: p['data'] });
    else if (type === 'image') texts.push('[image content omitted]');
    else texts.push(`[${String(type)} content omitted]`);
  }
  return { text: capMcpResult(texts.join('\n')), isError, ...(images.length > 0 ? { images } : {}) };
}
