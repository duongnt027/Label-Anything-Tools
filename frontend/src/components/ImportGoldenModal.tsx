import { FormEvent, useState } from "react";
import { getToken } from "../api";
import { MountFolderTree } from "./MountFolderTree";
import { ZipDropZone } from "./ZipDropZone";
import { ModalBusyOverlay } from "./ModalBusyOverlay";
import { useZipDropCapture } from "./useZipDropCapture";

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
  const [mountPath, setMountPath] = useState("");
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useZipDropCapture({
    active: !busy,
    disabled: busy,
    onZip: (f) => {
      setUploadTab("zip");
      setZipFile(f);
    },
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setErr("");
    const fd = new FormData();
    if (uploadTab === "mount") {
      if (!mountPath.trim()) {
        setErr("Chọn thư mục mount");
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
        headers: { Authorization: `Bearer ${getToken()}` },
        credentials: "same-origin",
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

  const uploadCaption =
    uploadTab === "mount"
      ? mountPath.trim() || "Chưa chọn thư mục"
      : zipFile
        ? zipFile.name
        : "Chưa chọn file ZIP";
  const uploadCaptionTitle = uploadTab === "mount" ? mountPath.trim() || undefined : zipFile?.name;

  return (
    <div
      className={`modal-backdrop ${busy ? "modal-busy" : ""}`}
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
      <div className="create-task-modal-shell import-golden-modal-shell">
        <ModalBusyOverlay show={busy} label="Đang import golden pool…" />
        <form className="create-task-modal import-golden-modal" onSubmit={submit}>
          <div className="modal-head create-task-modal-head">
            <h3>Import golden pool</h3>
            <button type="button" className="icon-btn-ghost" onClick={onClose} title="Đóng" disabled={busy}>
              ✕
            </button>
          </div>

          <div className="create-task-modal-body">
            <div className="task-screen-tabs create-task-upload-tabs">
              <button
                type="button"
                className={`task-screen-tab ${uploadTab === "mount" ? "active" : ""}`}
                onClick={() => setUploadTab("mount")}
                disabled={busy}
              >
                Mount
              </button>
              <button
                type="button"
                className={`task-screen-tab ${uploadTab === "zip" ? "active" : ""}`}
                onClick={() => setUploadTab("zip")}
                disabled={busy}
              >
                Upload ZIP
              </button>
            </div>

            <div className="create-task-upload-block">
              <div className="create-task-upload-panel">
                {uploadTab === "mount" ? (
                  <MountFolderTree value={mountPath} onChange={setMountPath} disabled={busy} />
                ) : (
                  <div className="create-task-scroll-shell create-task-zip-shell">
                    <ZipDropZone file={zipFile} onFile={setZipFile} disabled={busy} />
                  </div>
                )}
              </div>
              <p className="create-task-upload-caption" title={uploadCaptionTitle}>
                {uploadCaption}
              </p>
            </div>

            {err && <p className="form-error">{err}</p>}
          </div>

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
    </div>
  );
}
