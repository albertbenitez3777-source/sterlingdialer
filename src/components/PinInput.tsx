import { useRef, type KeyboardEvent, type ChangeEvent } from 'react';

type PinInputProps = {
  length?: number;
  value: string;
  onChange: (val: string) => void;
  onComplete?: (val: string) => void;
  hasError?: boolean;
};

/**
 * Large glassy PIN boxes with animated focus glow, auto-advance, backspace
 * navigation, and error shake. Honors prefers-reduced-motion via CSS.
 */
export function PinInput({ length = 4, value, onChange, onComplete, hasError = false }: PinInputProps) {
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  const chars = value.padEnd(length, ' ').slice(0, length).split('');

  const focusBox = (idx: number) => {
    const el = inputsRef.current[idx];
    if (el) { el.focus(); el.select(); }
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>, idx: number) => {
    const raw = e.target.value.replace(/\D/g, '');
    if (!raw) return;
    const next = value.split('');
    next[idx] = raw[raw.length - 1];
    const newVal = next.join('').slice(0, length);
    onChange(newVal);
    if (idx < length - 1) focusBox(idx + 1);
    else if (onComplete && newVal.length === length && !newVal.includes(' ')) onComplete(newVal);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>, idx: number) => {
    if (e.key === 'Backspace' && !chars[idx]?.trim() && idx > 0) {
      focusBox(idx - 1);
    }
    if (e.key === 'Enter' && onComplete && value.length === length) {
      onComplete(value);
    }
    if (e.key === 'ArrowLeft' && idx > 0) focusBox(idx - 1);
    if (e.key === 'ArrowRight' && idx < length - 1) focusBox(idx + 1);
  };

  return (
    <div className={`pin-input-row ${hasError ? 'pin-input-error' : ''}`}>
      {Array.from({ length }, (_, i) => (
        <input
          key={i}
          ref={(el) => { inputsRef.current[i] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={chars[i]?.trim() || ''}
          onChange={(e) => handleChange(e, i)}
          onKeyDown={(e) => handleKeyDown(e, i)}
          onFocus={(e) => e.target.select()}
          className="pin-input-box"
          style={{ animationDelay: `${0.1 + i * 0.08}s` }}
          aria-label={`PIN digit ${i + 1}`}
        />
      ))}
    </div>
  );
}
