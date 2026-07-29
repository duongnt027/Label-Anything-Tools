import { FormEvent, useState } from "react";
import { ModalBusyOverlay } from "./ModalBusyOverlay";
import { ImportTaskFileDropZone } from "./ImportTaskFileDropZone";
import { useImportTaskDropCapture } from "./useZipDropCapture";

export function ImportTaskModal({
  taskId,
  onClose,
  onImported,
}: {
  taskId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useImportTaskDropCapture({
    active: !busy,
    disabled: busy,
    onFile: setFile,
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setErr("");
    if (!file) {
      setErr("Chọn file ZIP hoặc annos.json");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/tasks/${taskId}/import`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("la_token")}` },
        credentials: "same-origin",
        body: fd,
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(typeof j.detail === "string" ? j.detail : "Import thất bại");
      }
      onImported();
      onClose();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`modal-backdrop ${busy ? "modal-busy" : ""}`}
      onClick={() => {
        if (!busy) onClose();
      }}
      onDragOver={(e) => {
        if (busy) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(e) => {
        if (busy) return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <form
        className={`admin-modal export-options-modal import-task-modal ${busy ? "modal-shell-busy" : ""}`}
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
      >
        <ModalBusyOverlay show={busy} label="Đang import task…" />
        <div className="modal-head">
          <h3>Import task (ZIP / JSON)</h3>
          <button type="button" className="icon-btn-ghost" onClick={onClose} title="Đóng" disabled={busy}>
            ✕
          </button>
        </div>

        <div className="field">
          <label className="field-label field-label-req">File</label>
          <div className="create-task-upload-block import-task-upload-block">
            <div className="create-task-scroll-shell import-task-drop-shell">
              <ImportTaskFileDropZone file={file} onFile={setFile} disabled={busy} />
            </div>
          </div>
          <p className="field-hint">
            ZIP export (<code>annos.json</code> + <code>images/</code>) hoặc chỉ <code>annos.json</code>. Khớp ảnh theo tên
            file.
          </p>
        </div>

        {err && <p className="form-error">{err}</p>}

        <div className="modal-actions-split">
          <button type="button" className="topbar-btn" onClick={onClose} disabled={busy}>
            Huỷ
          </button>
          <button type="submit" className="topbar-btn primary" disabled={busy}>
            {busy ? "Đang import…" : "Import"}
          </button>
        </div>
      </form>
    </div>
  );
}
