import { useEffect, useRef, useState } from "react";

type Props = {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  onInvalidChange?: (invalid: boolean) => void;
};

function parseText(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  if (Number.isNaN(n)) return null;
  return n;
}

export function NumberStepper({
  value,
  onChange,
  min = 0,
  max = 99999,
  disabled = false,
  onInvalidChange,
}: Props) {
  const [text, setText] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setText(String(value));
  }, [value]);

  const setInvalidState = (next: boolean) => {
    setInvalid(next);
    onInvalidChange?.(next);
  };

  const isOutOfRange = (n: number | null) => n === null || n < min || n > max;

  const resolvedValue = () => {
    const n = parseText(text);
    return n !== null && !isOutOfRange(n) ? n : value;
  };

  const commitText = (raw: string) => {
    const n = parseText(raw);
    const outOfRange = isOutOfRange(n);
    setInvalidState(outOfRange);
    if (!outOfRange && n !== null) {
      onChange(n);
      setText(String(n));
    } else {
      setText(raw.trim() === "" ? raw : raw.trim());
    }
  };

  const dec = () => {
    if (disabled) return;
    const next = Math.max(min, resolvedValue() - 1);
    onChange(next);
    setText(String(next));
    setInvalidState(false);
  };

  const inc = () => {
    if (disabled) return;
    const next = Math.min(max, resolvedValue() + 1);
    onChange(next);
    setText(String(next));
    setInvalidState(false);
  };

  return (
    <div className={`number-stepper ${disabled ? "is-disabled" : ""} ${invalid ? "is-invalid" : ""}`}>
      <button type="button" className="number-stepper-btn" onClick={dec} aria-label="Giảm" disabled={disabled}>
        −
      </button>
      <input
        type="text"
        inputMode="numeric"
        className="number-stepper-input"
        value={text}
        disabled={disabled}
        aria-invalid={invalid}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onBlur={() => {
          focusedRef.current = false;
          commitText(text);
        }}
        onChange={(e) => {
          if (disabled) return;
          const raw = e.target.value;
          if (raw !== "" && !/^-?\d*$/.test(raw)) return;
          setText(raw);
          if (invalid) setInvalidState(false);
        }}
      />
      <button type="button" className="number-stepper-btn" onClick={inc} aria-label="Tăng" disabled={disabled}>
        +
      </button>
    </div>
  );
}
