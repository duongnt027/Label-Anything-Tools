type Props = {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
};

export function NumberStepper({ value, onChange, min = 0, max = 99999 }: Props) {
  const dec = () => onChange(Math.max(min, value - 1));
  const inc = () => onChange(Math.min(max, value + 1));
  return (
    <div className="number-stepper">
      <button type="button" className="number-stepper-btn" onClick={dec} aria-label="Giảm">
        −
      </button>
      <input
        type="number"
        className="number-stepper-input"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = +e.target.value;
          if (!Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
      />
      <button type="button" className="number-stepper-btn" onClick={inc} aria-label="Tăng">
        +
      </button>
    </div>
  );
}
