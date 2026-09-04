/**
 * The voice meter behind the composer's mic (DESIGN-CONTRACT §4 "dictating").
 * A symmetric waveform that emanates from the centre: each frame the current loudness is pushed
 * into a ring of samples and every bar shows the sample that was at the centre `d` frames ago,
 * so energy visibly travels outwards and dies away instead of every bar twitching on its own.
 * Drawn on a canvas from a rAF loop; React never re-renders for audio.
 */
import { useEffect, useRef } from 'react';

const BARS = 33;            // odd, so one bar sits exactly in the middle
const SPREAD = 2;           // frames of delay per bar of distance from the centre
const IDLE = 0.06;          // breathing amplitude while listening but silent

export function VoiceMeter({ analyser, active, className }: { analyser: { current: AnalyserNode | null }; active: boolean; className?: string }): React.ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !active) return;
    const ctx2d = el.getContext('2d');
    if (!ctx2d) return;

    const history = new Float32Array(BARS * SPREAD + 1); // ring of recent loudness values
    let head = 0;
    const shown = new Float32Array(BARS);                  // smoothed per-bar height, 0..1
    let time = 0;
    let raf = 0;
    let buf: Float32Array<ArrayBuffer> | null = null;
    let peak = 0.05;                                       // adaptive normalisation so a quiet mic still moves

    const accent = getComputedStyle(el).getPropertyValue('--accent').trim() || '#5e6ad2';

    const frame = (): void => {
      raf = requestAnimationFrame(frame);
      time += 1;
      const node = analyser.current;
      let energy = 0;
      if (node) {
        if (!buf || buf.length !== node.fftSize) buf = new Float32Array(node.fftSize);
        node.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!;
        const rms = Math.sqrt(sum / buf.length);
        peak = Math.max(rms, peak * 0.995, 0.02);
        energy = Math.min(1, rms / peak);
      }
      // push into the ring
      head = (head + 1) % history.length;
      history[head] = energy;

      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth;
      const h = el.clientHeight;
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

      for (let i = 0; i < BARS; i++) {
        const d = Math.abs(i - mid);
        const delayed = history[(head - d * SPREAD + history.length * 2) % history.length]!;
        const falloff = 1 - (d / mid) * 0.75;                             // outer bars are quieter
        const breathe = IDLE * (0.6 + 0.4 * Math.sin(time / 22 + d * 0.35)); // never fully still
        const target = Math.max(breathe, Math.pow(delayed, 0.8) * falloff);
        // fast attack, slow release
        const cur = shown[i]!;
        shown[i] = target > cur ? cur + (target - cur) * 0.45 : cur + (target - cur) * 0.12;
        const bh = Math.max(2, shown[i]! * (h - 4));
        const x = x0 + i * (bw + gap);
        ctx2d.globalAlpha = 0.35 + 0.65 * (1 - (d / mid) * 0.6);
        ctx2d.fillStyle = accent;
        roundRect(ctx2d, x, cy - bh / 2, bw, bh, bw / 2);
      }
      ctx2d.globalAlpha = 1;
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [analyser, active]);

  return <canvas ref={canvas} className={className} aria-hidden />;
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
