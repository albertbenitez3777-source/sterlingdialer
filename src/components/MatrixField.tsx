import { useEffect, useRef, memo } from 'react';

const KATAKANA = '\u30A0\u30A1\u30A2\u30A3\u30A4\u30A5\u30A6\u30A7\u30A8\u30A9\u30AA\u30AB\u30AC\u30AD\u30AE\u30AF\u30B0\u30B1\u30B2\u30B3\u30B4\u30B5\u30B6\u30B7\u30B8\u30B9\u30BA\u30BB\u30BC\u30BD\u30BE\u30BF\u30C0\u30C1\u30C2\u30C3\u30C4\u30C5\u30C6\u30C7\u30C8\u30C9\u30CA\u30CB\u30CC\u30CD\u30CE\u30CF\u30D0\u30D1\u30D2\u30D3\u30D4\u30D5\u30D6\u30D7\u30D8\u30D9\u30DA\u30DB\u30DC\u30DD\u30DE\u30DF';
const DIGITS = '01';
const GLYPHS = KATAKANA + DIGITS + DIGITS + DIGITS;

function randomGlyph() {
  return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
}

interface Column {
  x: number;
  y: number;
  speed: number;
  reverse: boolean;
  chars: string[];
  trail: number;
  fontSize: number;
  brightness: number;
  nextSwap: number;
}

function createColumns(width: number, height: number): Column[] {
  const count = Math.max(60, Math.min(90, Math.floor(width / 16)));
  const cols: Column[] = [];
  for (let i = 0; i < count; i++) {
    const fontSize = 13 + Math.floor(Math.random() * 5);
    const trail = 12 + Math.floor(Math.random() * 18);
    const chars: string[] = [];
    for (let j = 0; j < trail; j++) chars.push(randomGlyph());
    cols.push({
      x: (i / count) * width + (Math.random() - 0.5) * 8,
      y: Math.random() * height * 1.5 - height * 0.25,
      speed: 1.2 + Math.random() * 3.2,
      reverse: Math.random() < 0.15,
      chars,
      trail,
      fontSize,
      brightness: 0.35 + Math.random() * 0.55,
      nextSwap: 0,
    });
  }
  return cols;
}

function MatrixFieldImpl() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const columnsRef = useRef<Column[]>([]);
  const reducedMotion = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion.current = mq.matches;
    const handler = (e: MediaQueryListEvent) => { reducedMotion.current = e.matches; };
    mq.addEventListener('change', handler);

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let frameCount = 0;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      canvas!.style.width = w + 'px';
      canvas!.style.height = h + 'px';
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      columnsRef.current = createColumns(w, h);
    }

    resize();
    window.addEventListener('resize', resize);

    function draw() {
      rafRef.current = requestAnimationFrame(draw);
      frameCount++;

      if (reducedMotion.current && frameCount % 8 !== 0) return;

      ctx!.clearRect(0, 0, w, h);

      const cols = columnsRef.current;
      const speedMul = reducedMotion.current ? 0.15 : 1;

      for (let c = 0; c < cols.length; c++) {
        const col = cols[c];
        const dir = col.reverse ? -1 : 1;
        col.y += col.speed * dir * speedMul;

        if (!col.reverse && col.y > h + col.trail * col.fontSize) {
          col.y = -col.trail * col.fontSize;
        } else if (col.reverse && col.y < -col.trail * col.fontSize) {
          col.y = h + col.trail * col.fontSize;
        }

        if (frameCount > col.nextSwap) {
          col.chars[Math.floor(Math.random() * col.trail)] = randomGlyph();
          col.nextSwap = frameCount + 2 + Math.floor(Math.random() * 6);
        }

        for (let j = 0; j < col.trail; j++) {
          const posY = col.y - j * col.fontSize * dir;
          if (posY < -col.fontSize || posY > h + col.fontSize) continue;

          const ratio = j / col.trail;
          if (j === 0) {
            ctx!.font = `bold ${col.fontSize + 2}px monospace`;
            ctx!.fillStyle = `rgba(200, 255, 230, ${col.brightness})`;
            ctx!.shadowColor = '#00ff9a';
            ctx!.shadowBlur = 18;
          } else if (j < 3) {
            ctx!.font = `bold ${col.fontSize}px monospace`;
            ctx!.fillStyle = `rgba(50, 255, 170, ${col.brightness * (1 - ratio * 0.3)})`;
            ctx!.shadowColor = '#00ff9a';
            ctx!.shadowBlur = 8;
          } else {
            ctx!.font = `${col.fontSize}px monospace`;
            const fade = Math.max(0, col.brightness * (1 - ratio));
            ctx!.fillStyle = `rgba(0, 255, 140, ${fade * 0.7})`;
            ctx!.shadowColor = 'transparent';
            ctx!.shadowBlur = 0;
          }

          ctx!.fillText(col.chars[j], col.x, posY);
        }

        ctx!.shadowColor = 'transparent';
        ctx!.shadowBlur = 0;
      }
    }

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
      mq.removeEventListener('change', handler);
    };
  }, []);

  return (
    <div className="matrix-field-v2" aria-hidden="true">
      <canvas ref={canvasRef} className="matrix-rain-canvas" />
      <div className="matrix-floor-grid" />
      <div className="matrix-bloom" />
      <div className="matrix-scanlines" />
      <div className="matrix-depth-fog" />
    </div>
  );
}

export const MatrixField = memo(MatrixFieldImpl);
