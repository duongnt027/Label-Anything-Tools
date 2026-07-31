import { RefObject } from "react";
import { Box } from "../api";
import { IconBox, IconEye, IconEyeOff, IconSegment } from "./icons";

type Props = {
  items: Box[];
  kind: "box" | "segment";
  selectedId: number | null;
  hiddenIds: Set<number>;
  colorOf: (cls: string) => string;
  onSelect: (id: number) => void;
  onToggleVisible: (id: number) => void;
  listRef?: RefObject<HTMLDivElement>;
};

export function AnnoShapeList({
  items,
  kind,
  selectedId,
  hiddenIds,
  colorOf,
  onSelect,
  onToggleVisible,
  listRef,
}: Props) {
  const Icon = kind === "segment" ? IconSegment : IconBox;
  return (
    <div className="anno-box-list pretty-scroll" ref={listRef}>
      {items.length === 0 && <span className="anno-muted">—</span>}
      {items.map((b) => {
        const hidden = hiddenIds.has(b.id);
        return (
          <div
            key={b.id}
            data-box-id={b.id}
            className={`anno-box-row ${selectedId === b.id ? "selected" : ""} ${hidden ? "hidden-box" : ""}`}
          >
            <button type="button" className="anno-box-row-main" onClick={() => onSelect(b.id)}>
              <span className={`anno-shape-kind-icon ${kind}`} style={{ color: colorOf(b.class) }} aria-hidden>
                <Icon size={13} />
              </span>
              <span className="anno-box-row-name">{b.class || "(no class)"}</span>
            </button>
            <button
              type="button"
              className={`anno-vis-btn ${hidden ? "off" : ""}`}
              title={hidden ? "Hiện" : "Ẩn"}
              onClick={(e) => {
                e.stopPropagation();
                onToggleVisible(b.id);
              }}
            >
              {hidden ? <IconEyeOff size={12} /> : <IconEye size={12} />}
            </button>
          </div>
        );
      })}
    </div>
  );
}
