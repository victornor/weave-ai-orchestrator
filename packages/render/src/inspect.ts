/**
 * `transcriptToLines` — a `TranscriptBlock[]` flattened into one short line per block, for a reader
 * that has no renderer (VS-61: the conductor's `ac_run_inspect`).
 *
 * The folding, the tool-target extraction and the redaction all happened in `runEventsToTranscript`
 * already; this only decides how much of each block survives and what the line reads like, so an
 * agent inspecting a run sees the same transcript the run page and `conductor attach` show.
 */
import { oneLine } from './format.js';
import type { ErrorBlock, FileBlock, HumanInputBlock, PhaseBlock, StatusBlock, TextBlock, ToolBlock, TranscriptBlock, TranscriptBlockKind } from './types.js';

/** One transcript block, rendered. `seq` locates it in the run, so a caller can resume from it. */
export interface InspectionLine {
  seq: number;
  ts: string;
  kind: TranscriptBlockKind;
  text: string;
}

export interface InspectionLineOptions {
  /** Cap on assistant text and thinking, per line. Default 600 characters. */
  maxTextChars?: number;
  /** Cap on the failure detail appended to a tool line. Default 200 characters. */
  maxDetailChars?: number;
}

const DEFAULT_TEXT_CHARS = 600;
const DEFAULT_DETAIL_CHARS = 200;

/** Truncate, keeping the shape of the text: newlines survive, an ellipsis marks the cut. */
function clamp(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max).trimEnd()}…`;
}

/** The first non-empty line of a tool's output, for the one case where it matters: a failure. */
function firstLine(detail: string | null, max: number): string | null {
  if (!detail) return null;
  const line = detail.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
  return line ? oneLine(line, max) : null;
}

function lineFor(block: TranscriptBlock, textChars: number, detailChars: number): string {
  switch (block.kind) {
    case 'text':
    case 'thinking':
      return clamp((block as TextBlock).text, textChars);

    case 'tool': {
      const tool = block as ToolBlock;
      // Only a failure earns its output: everything else is already in the collapsed line.
      const detail = tool.status === 'error' || tool.status === 'denied' ? firstLine(tool.detail, detailChars) : null;
      return detail ? `${tool.collapsed} — ${detail}` : tool.collapsed;
    }

    case 'file':
      return (block as FileBlock).collapsed;

    case 'phase':
      return (block as PhaseBlock).text;

    case 'status': {
      const s = block as StatusBlock;
      return s.tone === 'info' ? s.text : `${s.tone}: ${s.text}`;
    }

    case 'error': {
      const e = block as ErrorBlock;
      return e.code ? `[${e.code}] ${e.message}` : e.message;
    }

    case 'human_input': {
      const h = block as HumanInputBlock;
      return `${h.authorKind}: ${clamp(h.text, textChars)} (${h.delivery === 'mid_turn' ? 'mid-turn' : 'queued'})`;
    }
  }
}

/**
 * Flatten a transcript into lines. Phase markers, status lines and errors are kept whole — they are
 * short and they are the ones a supervisor acts on; assistant text and failed tool output are
 * clamped. A block that renders to nothing is dropped rather than emitted blank.
 */
export function transcriptToLines(blocks: readonly TranscriptBlock[] | null | undefined, options: InspectionLineOptions = {}): InspectionLine[] {
  if (!Array.isArray(blocks)) return [];
  const textChars = options.maxTextChars ?? DEFAULT_TEXT_CHARS;
  const detailChars = options.maxDetailChars ?? DEFAULT_DETAIL_CHARS;
  const lines: InspectionLine[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const text = lineFor(block, textChars, detailChars);
    if (!text || !text.trim()) continue;
    lines.push({ seq: block.seq, ts: block.ts, kind: block.kind, text });
  }
  return lines;
}
