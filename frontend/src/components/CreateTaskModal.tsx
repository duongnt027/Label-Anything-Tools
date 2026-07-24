import { FormEvent, useState, KeyboardEvent } from "react";
import { NumberStepper } from "./NumberStepper";
import { classColor, classColorBg } from "../utils/classColors";

type ClassChip = { name: string; color: string; bg: string };

export function CreateTaskModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [chunkSize, setChunkSize] = useState(10);
  const [classChips, setClassChips] = useState<ClassChip[]>([]);
  const [classInput, setClassInput] = useState("");
  const [golden, setGolden] = useState(0);
  const [minRole, setMinRole] = useState("admin");
  const [uploadTab, setUploadTab] = useState<"mount" | "zip">("mount");
  const [mountPath, setMountPath] = useState("sample_images");
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [err, setErr] = useState("");

  const addClassChip = (raw: string) => {
    const n = raw.trim();
    if (!n) return;
    if (classChips.some((c) => c.name.toLowerCase() === n.toLowerCase())) return;
    const i = classChips.length;
    setClassChips((prev) => [...prev, { name: n, color: classColor(i), bg: classColorBg(i) }]);
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
    setErr("");
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

    try {
      const r = await fetch("/api/tasks", {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("la_token")}` },
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
    }
  };

  return (
    <div className="modal-backdrop">
      <form className="admin-modal create-task-modal" onSubmit={submit}>
        <div className="modal-head">
          <h3>Tạo task</h3>
          <button type="button" className="icon-btn-ghost" onClick={onClose} title="Đóng">
            ✕
          </button>
        </div>

        <div className="form-row-2">
          <div className="field">
            <label className="field-label">Tên task</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tuỳ chọn" />
          </div>
          <div className="field">
            <label className="field-label field-label-req">Chunk size</label>
            <NumberStepper value={chunkSize} onChange={setChunkSize} min={1} />
          </div>
        </div>

        <div className="form-row-2">
          <div className="field">
            <label className="field-label">Min role thêm class</label>
            <select value={minRole} onChange={(e) => setMinRole(e.target.value)}>
              <option value="admin">admin</option>
              <option value="reviewer">reviewer</option>
              <option value="annotator">annotator</option>
            </select>
          </div>
          <div className="field">
            <label className="field-label">Golden / job</label>
            <NumberStepper value={golden} onChange={setGolden} min={0} />
          </div>
        </div>

        <div className="field">
          <label className="field-label">Classes</label>
          <div className="class-chips-wrap class-chips-scroll">
            {classChips.map((c) => (
              <span
                key={c.name}
                className="class-chip-colored"
                style={{ borderColor: c.color, background: c.bg, color: c.color }}
              >
                {c.name}
                <button type="button" onClick={() => removeChip(c.name)} aria-label="Xóa">
                  ×
                </button>
              </span>
            ))}
          </div>
          <input
            placeholder="Nhập class, Enter để thêm"
            value={classInput}
            onChange={(e) => setClassInput(e.target.value)}
            onKeyDown={onClassKeyDown}
          />
        </div>

        <div className="upload-tabs">
          <button
            type="button"
            className={`tab-btn ${uploadTab === "mount" ? "active" : ""}`}
            onClick={() => setUploadTab("mount")}
          >
            📁 Mount
          </button>
          <button
            type="button"
            className={`tab-btn ${uploadTab === "zip" ? "active" : ""}`}
            onClick={() => setUploadTab("zip")}
          >
            📦 Upload ZIP
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
            <input type="file" accept=".zip,application/zip" onChange={(e) => setZipFile(e.target.files?.[0] ?? null)} />
          </div>
        )}

        {err && <p className="form-error">{err}</p>}

        <div className="modal-actions-split">
          <button type="button" className="topbar-btn" onClick={onClose}>
            Huỷ
          </button>
          <button type="submit" className="topbar-btn primary">
            ✓ Tạo
          </button>
        </div>
      </form>
    </div>
  );
}
