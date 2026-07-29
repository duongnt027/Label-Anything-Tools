import { useEffect, useRef, useState } from "react";
import { isZipFile, pickZipFromDataTransfer } from "../utils/zipDropUtils";

type Props = {
  file: File | null;
  onFile: (file: File | null) => void;
  disabled?: boolean;
};

export function ZipDropZone({ file, onFile, disabled = false }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  const acceptFile = (f: File | null) => {
    if (disabledRef.current || !f) return;
    if (!isZipFile(f)) {
      window.alert("Chỉ chấp nhận file .zip");
      return;
    }
    onFile(f);
  };

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const onDragOver = (e: DragEvent) => {
      if (disabledRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      setDragOver(true);
    };

    const onDragLeave = (e: DragEvent) => {
      if (disabledRef.current) return;
      const rel = e.relatedTarget as Node | null;
      if (rel && el.contains(rel)) return;
      setDragOver(false);
    };

    const onDrop = (e: DragEvent) => {
      if (disabledRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      acceptFile(pickZipFromDataTransfer(e.dataTransfer));
    };

    el.addEventListener("dragenter", onDragOver);
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onDrop);
    return () => {
      el.removeEventListener("dragenter", onDragOver);
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("dragleave", onDragLeave);
      el.removeEventListener("drop", onDrop);
    };
  }, [onFile]);

  return (
    <div
      ref={rootRef}
      className={`create-task-zip-drop ${dragOver ? "drag-over" : ""} ${file ? "has-file" : ""} ${disabled ? "is-disabled" : ""}`}
      onClick={() => {
        if (!disabled) inputRef.current?.click();
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip,application/x-zip-compressed"
        className="create-task-zip-file-input"
        disabled={disabled}
        onChange={(e) => acceptFile(e.target.files?.[0] ?? null)}
      />
      {file ? (
        <div className="create-task-zip-file">
          <span className="create-task-zip-picked">ZIP đã chọn</span>
          <span className="create-task-zip-name" title={file.name}>
            {file.name}
          </span>
          <button
            type="button"
            className="create-task-zip-clear"
            title="Xóa file"
            disabled={disabled}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
              onFile(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
          >
            ×
          </button>
        </div>
      ) : (
        <>
          <span className="create-task-zip-title">Kéo thả file ZIP vào đây</span>
          <span className="create-task-zip-hint">hoặc click để chọn</span>
        </>
      )}
    </div>
  );
}
