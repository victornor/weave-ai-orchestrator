/**
 * DeepSeek's native tool-call syntax as it appears when a gateway hands it back as message text:
 * `<｜DSML｜invoke name="bash">`, with one or two full-width (or ASCII) bars on either side of DSML
 * (the VS-639 runs showed the doubled form). Only a known marker followed by `invoke` matches.
 */
const DSML_INVOKE = /<[｜|]{1,2}\s*DSML\s*[｜|]{1,2}\s*invoke\b/;

/**
 * Which text-form tool-call syntax a reply's text carries, or null. A diagnostic only: the result picks
 * an error message and never produces a tool call, so nothing parsed from message text is executed.
 */
export function detectTextToolCalls(text: string): 'dsml' | null {
  return DSML_INVOKE.test(text) ? 'dsml' : null;
}
