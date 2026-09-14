import { memo, useEffect, useRef } from 'react';
import './MatrixField.css';

const GLYPHS =
  '01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF<>$#*%';

type Column = {
  x: number;
  y: number;
  speed: number;
  dir: 1 | -1;
  size: number;
  length: number;
};

function paintRain(ctx: CanvasRenderingContext2D, width: number, height: number, columns: Column[], tick: number) {
  ctx.fillStyle = 'rgba(0, 6, 5, 0.18)';
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(width * 0.5, height * 0.48, 12, width * 0.5, height * 0.5, Math.max(width, height) * 0.62);
  glow.addColorStop(0, 'rgba(0, 255, 170, 0.16)');
  glow.addColorStop(0.22, 'rgba(0, 140, 95, 0.07)');
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  for (const col of columns) {
    col.y += col.speed * col.dir;
    if (col.dir === 1 && col.y - col.length * col.size > height) col.y = -col.size;
    if (col.dir === -1 && col.y + col.length * col.size < 0) col.y = height + col.size;

    for (let i = 0; i < col.length; i++) {
      const gy = col.y - i * col.size * col.dir;
      if (gy < -20 || gy > height + 20) continue;
      const head = i === 0;
      const alpha = head ? 1 : Math.max(0.08, 1 - i / col.length);
      ctx.font = `${head ? 700 : 500} ${col.size}px "JetBrains Mono", "Share Tech Mono", ui-monospace, monospace`;
      ctx.fillStyle = head
        ? 'rgba(210, 255, 236, 0.92)'
        : i < 3
          ? `rgba(120, 255, 200, ${alpha})`
          : `rgba(18, 210, 130, ${alpha * 0.85})`;
      ctx.shadowColor = head ? '#4dffc2' : 'transparent';
      ctx.shadowBlur = head ? 14 : 0;
      const ch = GLYPHS[(tick + i * 7 + Math.floor(col.x) * 13) % GLYPHS.length];
      ctx.fillText(ch, col.x, gy);
    }
  }
  ctx.shadowBlur = 0;
}

function MatrixFieldImpl({ density = 'full' }: { density?: 'full' | 'ops' }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let columns: Column[] = [];
    let frame = 0;
    let raf = 0;
    let tick = 0;

    const layout = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round((width / (density === 'ops' ? 22 : 16)) * (reduced ? 0.35 : 1));
      columns = Array.from({ length: count }, (_, i) => {
        const size = density === 'ops' ? 11 + (i % 4) : 12 + (i % 7);
        return {
          x: (i * width) / count + (i % 3) * 2,
          y: Math.random() * height,
          speed: 0.55 + (i % 9) * 0.28,
          dir: (i % 5 === 0 ? -1 : 1) as 1 | -1,
          size,
          length: 10 + (i % 18),
        };
      });
    };

    layout();
    const ro = new ResizeObserver(layout);
    ro.observe(canvas);

    const draw = () => {
      const { width, height } = canvas.getBoundingClientRect();
      if (frame % 2 === 0) {
        tick += 1;
        paintRain(ctx, width, height, columns, tick);
      }
      frame += 1;
      if (!reduced) raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [density]);

  return (
    <div className={`matrix-corridor matrix-corridor-${density}`} aria-hidden="true">
      <canvas ref={canvasRef} className="matrix-rain" />
      <div className="matrix-ceiling" />
      <div className="matrix-floor">
        <div className="matrix-floor-grid" />
      </div>
      <div className="matrix-wall matrix-wall-left" />
      <div className="matrix-wall matrix-wall-right" />
      <div className="matrix-scan matrix-scan-a">01001101 01100001 01110100 01110010 01101001 01111000 00100000 01000110 01001111</div>
      <div className="matrix-scan matrix-scan-b">10110100 01101100 01101001 01110110 01100101 00100000 01100011 01101111 01110010 01100101</div>
      <div className="matrix-bloom" />
      <div className="matrix-vignette" />
    </div>
  );
}

export const MatrixField = memo(MatrixFieldImpl);
