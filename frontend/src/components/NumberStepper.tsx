type Props = {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
};

export function NumberStepper({ value, onChange, min = 0, max = 99999, disabled = false }: Props) {
  const dec = () => {
    if (disabled) return;
    onChange(Math.max(min, value - 1));
  };
  const inc = () => {
    if (disabled) return;
    onChange(Math.min(max, value + 1));
  };
  return (
    <div className={`number-stepper ${disabled ? "is-disabled" : ""}`}>
      <button type="button" className="number-stepper-btn" onClick={dec} aria-label="Giảm" disabled={disabled}>
        −
      </button>
      <input
        type="number"
        className="number-stepper-input"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          if (disabled) return;
          const n = +e.target.value;
          if (!Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
      />
      <button type="button" className="number-stepper-btn" onClick={inc} aria-label="Tăng" disabled={disabled}>
        +
      </button>
    </div>
  );
}
