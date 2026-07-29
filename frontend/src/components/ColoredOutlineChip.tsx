import { KeyboardEvent, MouseEvent } from "react";

type Props = {
  label: string;
  color: string;
  active?: boolean;
  onLabelClick?: () => void;
  onRemove?: () => void;
  removeDisabled?: boolean;
};

export function ColoredOutlineChip({
  label,
  color,
  active,
  onLabelClick,
  onRemove,
  removeDisabled,
}: Props) {
  const onChipClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest(".colored-outline-chip-x")) return;
    onLabelClick?.();
  };

  const onChipKeyDown = (e: KeyboardEvent) => {
    if (!onLabelClick) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onLabelClick();
    }
  };

  return (
    <span
      className={`colored-outline-chip ${active ? "active" : ""} ${onLabelClick ? "colored-outline-chip-clickable" : ""}`}
      style={{ ["--chip-color" as string]: color }}
      onClick={onLabelClick ? onChipClick : undefined}
      onKeyDown={onLabelClick ? onChipKeyDown : undefined}
      role={onLabelClick ? "button" : undefined}
      tabIndex={onLabelClick ? 0 : undefined}
    >
      <span className="colored-outline-chip-dot" aria-hidden />
      <span className="colored-outline-chip-label">{label}</span>
      {onRemove != null && (
        <button
          type="button"
          className="colored-outline-chip-x"
          disabled={removeDisabled}
          aria-label={`Xóa ${label}`}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      )}
    </span>
  );
}
