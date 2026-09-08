import { useRef, type KeyboardEvent, type ChangeEvent, type ClipboardEvent } from 'react';

type PinInputProps = {
  length?: number;
  value: string;
  onChange: (val: string) => void;
  onComplete?: (val: string) => void;
  hasError?: boolean;
  disabled?: boolean;
};

/**
 * Large glassy PIN boxes with animated focus glow, auto-advance, backspace
 * navigation, and error shake. Honors prefers-reduced-motion via CSS.
 */
export function PinInput({ length = 4, value, onChange, onComplete, hasError = false, disabled = false }: PinInputProps) {
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  const chars = value.padEnd(length, ' ').slice(0, length).split('');

  const focusBox = (idx: number) => {
    const el = inputsRef.current[idx];
    if (el) { el.focus(); el.select(); }
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>, idx: number) => {
    if (disabled) return;
    const raw = e.target.value.replace(/\D/g, '');
    const next = [...chars];
    next[idx] = raw ? raw[raw.length - 1] : ' ';
    const newVal = next.join('').trimEnd();
    onChange(newVal);
    if (raw && idx < length - 1) focusBox(idx + 1);
    if (raw && newVal.length === length && /^\d+$/.test(newVal)) onComplete?.(newVal);
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>, idx: number) => {
    e.preventDefault();
    if (disabled) return;
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!digits) return;
    const start = digits.length === length ? 0 : idx;
    const next = [...chars];
    for (let i = 0; i < digits.length && start + i < length; i++) next[start + i] = digits[i];
    const newVal = next.join('').trimEnd();
    onChange(newVal);
    focusBox(Math.min(start + digits.length, length - 1));
    if (newVal.length === length && /^\d+$/.test(newVal)) onComplete?.(newVal);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>, idx: number) => {
    if (disabled) return;
    if (e.key === 'Backspace' && !chars[idx]?.trim() && idx > 0) {
      focusBox(idx - 1);
    }
    if (e.key === 'Enter' && onComplete && value.length === length && /^\d+$/.test(value)) {
      e.preventDefault();
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
          type="password"
          inputMode="numeric"
          maxLength={1}
          value={chars[i]?.trim() || ''}
          onChange={(e) => handleChange(e, i)}
          onPaste={(e) => handlePaste(e, i)}
          onKeyDown={(e) => handleKeyDown(e, i)}
          onFocus={(e) => e.target.select()}
          className="pin-input-box"
          style={{ animationDelay: `${0.1 + i * 0.08}s` }}
          aria-label={`PIN digit ${i + 1}`}
          disabled={disabled}
        />
      ))}
    </div>
  );
}
