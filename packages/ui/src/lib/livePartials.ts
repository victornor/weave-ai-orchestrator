/**
 * The partial output a live run is still generating (VS-595). The pure merge lives in
 * `@weave-ai/render` (VS-603) so the web, the terminal UI and the CLI follow output share one
 * implementation; this module is the web's existing import path.
 */
export { applyDelta, fromSnapshot, dropSuperseded, type PartialMap, type PartialText } from '@weave-ai/render';
