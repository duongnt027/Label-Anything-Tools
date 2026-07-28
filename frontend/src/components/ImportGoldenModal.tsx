import { FormEvent, useState } from "react";

export function ImportGoldenModal({
  taskId,
  onClose,
  onImported,
}: {
  taskId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [uploadTab, setUploadTab] = useState<"mount" | "zip">("mount");
  const [mountPath, setMountPath] = useState("sample_images");
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr("");
    const fd = new FormData();
    if (uploadTab === "mount") {
      if (!mountPath.trim()) {
        setErr("Nhập đường dẫn mount");
        return;
      }
      fd.append("server_folder", mountPath.trim());
    } else {
      if (!zipFile) {
        setErr("Chọn file ZIP");
        return;
      }
      fd.append("files", zipFile, zipFile.name);
    }
    setBusy(true);
    try {
      const r = await fetch(`/api/tasks/${taskId}/golden-pool/import`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("la_token")}` },
        body: fd,
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.detail || "Import thất bại");
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
      <form
        className="admin-modal import-golden-modal"
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3>Import golden pool</h3>
          <button type="button" className="icon-btn-ghost" onClick={onClose} title="Đóng">
            ✕
          </button>
        </div>

        <div className="task-screen-tabs import-golden-tabs">
          <button
            type="button"
            className={`task-screen-tab ${uploadTab === "mount" ? "active" : ""}`}
            onClick={() => setUploadTab("mount")}
          >
            Mount
          </button>
          <button
            type="button"
            className={`task-screen-tab ${uploadTab === "zip" ? "active" : ""}`}
            onClick={() => setUploadTab("zip")}
          >
            Import ZIP
          </button>
        </div>

        {uploadTab === "mount" ? (
          <div className="field">
            <label className="field-label field-label-req">Đường dẫn trên server</label>
            <input
              value={mountPath}
              onChange={(e) => setMountPath(e.target.value)}
              placeholder="sample_images"
            />
            <p className="field-hint">Thư mục mount trong container (vd: sample_images)</p>
          </div>
        ) : (
          <div className="field">
            <label className="field-label field-label-req">File ZIP</label>
            <input
              type="file"
              accept=".zip,application/zip"
              onChange={(e) => setZipFile(e.target.files?.[0] ?? null)}
            />
          </div>
        )}

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
