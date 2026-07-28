import { FormEvent, useState } from "react";

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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr("");
    if (!file) {
      setErr("Chọn file JSON");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/tasks/${taskId}/import`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("la_token")}` },
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
    <div className="modal-backdrop" onClick={onClose}>
      <form className="admin-modal export-options-modal" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Import task (JSON)</h3>
          <button type="button" className="icon-btn-ghost" onClick={onClose} title="Đóng">
            ✕
          </button>
        </div>

        <div className="field">
          <label className="field-label field-label-req">File JSON</label>
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <p className="field-hint">Import annotation JSON vào task hiện tại.</p>
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
