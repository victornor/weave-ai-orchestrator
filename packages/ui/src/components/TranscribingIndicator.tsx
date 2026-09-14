/**
 * The "transcribing" indicator (VS-441), shown from the moment an upload-mode dictation stops
 * until its transcript lands or the attempt fails. It is the listening meter settling: the same
 * bars and accent (`--accent`) with a gentle pulse travelling across them, plus a quiet label.
 *
 * Drawn on a canvas from a rAF loop, like `VoiceMeter`, so React never re-renders for it. Under
 * reduced motion it draws a single static frame: the bar shape stays, the travel does not.
 */
import { useEffect, useRef } from 'react';

const BARS = 21; // odd, so one bar sits at the centre
const IDLE = 0.1; // baseline height, so no bar is ever a dot

export function TranscribingIndicator({ className, reducedMotion = false }: { className?: string; reducedMotion?: boolean }): React.ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null);
  /**
   * The measured, laid-out box. The caller sizes this and only this; the canvas is `100%` of it, so
   * the backing store can never feed back into layout (the VS-431 trap).
   */
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const frameBox = box.current;
    if (!el || !frameBox) return;
    const ctx2d = el.getContext('2d');
    if (!ctx2d) return;

    const shown = new Float32Array(BARS);
    let time = 0;
    let raf = 0;
    const accent = getComputedStyle(frameBox).getPropertyValue('--accent').trim() || '#5e6ad2';

    const draw = (): void => {
      const w = frameBox.clientWidth;
      const h = frameBox.clientHeight;
      if (w <= 0 || h <= 0) return;
      const dpr = window.devicePixelRatio || 1;
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx2d.clearRect(0, 0, w, h);

      const mid = (BARS - 1) / 2;
      const gap = 3;
      const bw = Math.max(2, Math.floor((w - gap * (BARS - 1)) / BARS));
      const total = BARS * bw + (BARS - 1) * gap;
      const x0 = (w - total) / 2;
      const cy = h / 2;
      // The pulse travels out to the right and back, so it reads as energy moving outward from the
      // centre — the same motion language as the listening meter's centred waveform.
      const sweep = (time / 46) % 2;
      const front = sweep <= 1 ? sweep : 2 - sweep;

      for (let i = 0; i < BARS; i++) {
        const d = Math.abs(i - mid) / mid;
        const pulse = Math.exp(-Math.pow(d - front, 2) / 0.014);
        const falloff = 1 - d * 0.55;
        const target = IDLE + 0.8 * pulse * falloff;
        const cur = shown[i]!;
        shown[i] = target > cur ? cur + (target - cur) * 0.5 : cur + (target - cur) * 0.16;
        const bh = Math.max(2, shown[i]! * (h - 4));
        const x = x0 + i * (bw + gap);
        ctx2d.globalAlpha = 0.4 + 0.6 * (1 - d * 0.5);
        ctx2d.fillStyle = accent;
        roundRect(ctx2d, x, cy - bh / 2, bw, bh, bw / 2);
      }
      ctx2d.globalAlpha = 1;
    };

    if (reducedMotion) {
      // One static frame: the shape of the indicator, with no travel.
      time = 12;
      draw();
      return;
    }

    const frame = (): void => {
      raf = requestAnimationFrame(frame);
      time += 1;
      draw();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [reducedMotion]);

  return (
    <span role="status" aria-live="polite" className="flex min-w-0 flex-1 items-center gap-2">
      <div ref={box} className={className} aria-hidden>
        <canvas ref={canvas} className="block h-full w-full" />
      </div>
      <span className="text-micro text-text-3">Transcribing…</span>
    </span>
  );
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.lineTo(x + w - rr, y);
  c.arcTo(x + w, y, x + w, y + rr, rr);
  c.lineTo(x + w, y + h - rr);
  c.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  c.lineTo(x + rr, y + h);
  c.arcTo(x, y + h, x, y + h - rr, rr);
  c.lineTo(x, y + rr);
  c.arcTo(x, y, x + rr, y, rr);
  c.closePath();
  c.fill();
}