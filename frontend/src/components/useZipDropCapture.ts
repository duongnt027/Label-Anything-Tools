import { useEffect, useRef } from "react";
import {
  dataTransferHasFiles,
  pickImportTaskFileFromDataTransfer,
  pickZipFromDataTransfer,
} from "../utils/zipDropUtils";

function useFileDropCapture(options: {
  active: boolean;
  disabled?: boolean;
  pick: (dt: DataTransfer | null) => File | null;
  onFile: (file: File) => void;
}) {
  const onFileRef = useRef(options.onFile);
  onFileRef.current = options.onFile;
  const pickRef = useRef(options.pick);
  pickRef.current = options.pick;
  const disabledRef = useRef(options.disabled ?? false);
  disabledRef.current = options.disabled ?? false;

  useEffect(() => {
    if (!options.active) return;

    const onDragOver = (e: DragEvent) => {
      if (disabledRef.current) return;
      const dt = e.dataTransfer;
      if (dt?.types?.length && !dataTransferHasFiles(dt)) return;
      e.preventDefault();
      if (dt) dt.dropEffect = "copy";
    };

    const onDrop = (e: DragEvent) => {
      if (disabledRef.current) return;
      e.preventDefault();
      const f = pickRef.current(e.dataTransfer);
      if (f) {
        e.stopPropagation();
        e.stopImmediatePropagation();
        onFileRef.current(f);
      }
    };

    document.addEventListener("dragover", onDragOver, true);
    document.addEventListener("drop", onDrop, true);
    return () => {
      document.removeEventListener("dragover", onDragOver, true);
      document.removeEventListener("drop", onDrop, true);
    };
  }, [options.active]);
}

/** Capture-phase listeners so OS file drops work reliably inside modals. */
export function useZipDropCapture(options: {
  active: boolean;
  disabled?: boolean;
  onZip: (file: File) => void;
}) {
  useFileDropCapture({
    active: options.active,
    disabled: options.disabled,
    pick: pickZipFromDataTransfer,
    onFile: options.onZip,
  });
}

export function useImportTaskDropCapture(options: {
  active: boolean;
  disabled?: boolean;
  onFile: (file: File) => void;
}) {
  useFileDropCapture({
    active: options.active,
    disabled: options.disabled,
    pick: pickImportTaskFileFromDataTransfer,
    onFile: options.onFile,
  });
}
