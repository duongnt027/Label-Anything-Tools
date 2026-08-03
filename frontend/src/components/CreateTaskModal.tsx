import { FormEvent, useState, KeyboardEvent } from "react";
import { NumberStepper } from "./NumberStepper";
import { ColoredOutlineChip } from "./ColoredOutlineChip";
import { MountFolderTree } from "./MountFolderTree";
import { ZipDropZone } from "./ZipDropZone";
import { ModalBusyOverlay } from "./ModalBusyOverlay";
import { useZipDropCapture } from "./useZipDropCapture";
import { classColor } from "../utils/classColors";

type ClassChip = { name: string; color: string };

export function CreateTaskModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [chunkSize, setChunkSize] = useState(10);
  const [classChips, setClassChips] = useState<ClassChip[]>([]);
  const [classInput, setClassInput] = useState("");
  const [golden, setGolden] = useState(2);
  const [chunkInvalid, setChunkInvalid] = useState(false);
  const [goldenInvalid, setGoldenInvalid] = useState(false);
  const [minRole, setMinRole] = useState("admin");
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

  const addClassChip = (raw: string) => {
    const n = raw.trim();
    if (!n) return;
    if (classChips.some((c) => c.name.toLowerCase() === n.toLowerCase())) return;
    const i = classChips.length;
    setClassChips((prev) => [...prev, { name: n, color: classColor(i) }]);
    setClassInput("");
  };

  const onClassKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addClassChip(classInput);
    }
  };

  const removeChip = (name: string) => setClassChips((prev) => prev.filter((c) => c.name !== name));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setErr("");
    if (chunkInvalid || goldenInvalid || chunkSize < 2 || golden < 2) {
      setErr("Chunk size và Golden / job phải ≥ 2");
      return;
    }
    const fd = new FormData();
    fd.append("chunk_size", String(chunkSize));
    if (name) fd.append("name", name);
    fd.append("classes", classChips.map((c) => c.name).join(","));
    fd.append("min_role_to_add_class", minRole);
    fd.append("golden_per_job", String(golden));

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
      const r = await fetch("/api/tasks", {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("la_token")}` },
        credentials: "same-origin",
        body: fd,
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.detail || "Tạo task thất bại");
      }
      onCreated();
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
      <div className="create-task-modal-shell">
        <ModalBusyOverlay show={busy} label="Đang tạo task…" />
      <form className="create-task-modal" onSubmit={submit}>
        <div className="modal-head create-task-modal-head">
          <h3>Tạo task</h3>
          <button type="button" className="icon-btn-ghost" onClick={onClose} title="Đóng" disabled={busy}>
            ✕
          </button>
        </div>

        <div className="create-task-modal-body">
        <div className="form-row-2">
          <div className="field">
            <label className="field-label">Tên task</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tuỳ chọn" disabled={busy} />
          </div>
          <div className="field">
            <label className="field-label field-label-req">Chunk size</label>
            <NumberStepper
              value={chunkSize}
              onChange={setChunkSize}
              min={2}
              disabled={busy}
              onInvalidChange={setChunkInvalid}
            />
          </div>
        </div>

        <div className="form-row-2">
          <div className="field">
            <label className="field-label">Min role thêm class</label>
            <select value={minRole} onChange={(e) => setMinRole(e.target.value)} disabled={busy}>
              <option value="admin">admin</option>
              <option value="reviewer">reviewer</option>
              <option value="annotator">annotator</option>
            </select>
          </div>
          <div className="field">
            <label className="field-label">Golden / job</label>
            <NumberStepper
              value={golden}
              onChange={setGolden}
              min={2}
              disabled={busy}
              onInvalidChange={setGoldenInvalid}
            />
          </div>
        </div>

        <div className="field">
          <label className="field-label">Classes</label>
          <div className="create-task-scroll-shell create-task-class-combo">
            <div className="class-chips-wrap class-chips-inner pretty-scroll">
              {classChips.map((c) => (
                <ColoredOutlineChip
                  key={c.name}
                  label={c.name}
                  color={c.color}
                  onRemove={() => removeChip(c.name)}
                />
              ))}
            </div>
            <input
              className="create-task-class-input"
              placeholder="Nhập class, Enter để thêm"
              value={classInput}
              onChange={(e) => setClassInput(e.target.value)}
              onKeyDown={onClassKeyDown}
              disabled={busy}
            />
          </div>
        </div>

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
            {busy ? "Đang tạo…" : "✓ Tạo"}
          </button>
        </div>
      </form>
      </div>
    </div>
  );
}
