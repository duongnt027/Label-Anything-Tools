import { FormEvent, useState } from "react";

export type BoxVisibility = "all" | "visible" | "invisible";

export type ExportOptions = {
  includeImages: boolean;
  boxVisibility: BoxVisibility;
};

export function ExportOptionsModal({
  title = "Export",
  onClose,
  onConfirm,
}: {
  title?: string;
  onClose: () => void;
  onConfirm: (opts: ExportOptions) => void | Promise<void>;
}) {
  const [includeImages, setIncludeImages] = useState(false);
  const [boxVisibility, setBoxVisibility] = useState<BoxVisibility>("all");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await onConfirm({ includeImages, boxVisibility });
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
          <h3>{title}</h3>
          <button type="button" className="icon-btn-ghost" onClick={onClose} title="Đóng">
            ✕
          </button>
        </div>

        <label className="export-opt-check">
          <input
            type="checkbox"
            className="jobs-tick"
            checked={includeImages}
            onChange={(e) => setIncludeImages(e.target.checked)}
          />
          <span>Kèm ảnh</span>
        </label>
        <p className="field-hint">
          Export file ZIP: <code>annos.json</code> và (nếu bật) thư mục <code>images/</code>. Box dùng{" "}
          <code>x_center</code>, <code>y_center</code>, <code>w</code>, <code>h</code>.
        </p>

        <fieldset className="export-box-visibility">
          <legend>Visible box</legend>
          <label className="export-opt-radio">
            <input
              type="radio"
              name="box_visibility"
              checked={boxVisibility === "all"}
              onChange={() => setBoxVisibility("all")}
            />
            <span>All boxes</span>
          </label>
          <label className="export-opt-radio">
            <input
              type="radio"
              name="box_visibility"
              checked={boxVisibility === "visible"}
              onChange={() => setBoxVisibility("visible")}
            />
            <span>Visible boxes</span>
          </label>
          <label className="export-opt-radio">
            <input
              type="radio"
              name="box_visibility"
              checked={boxVisibility === "invisible"}
              onChange={() => setBoxVisibility("invisible")}
            />
            <span>Invisible boxes</span>
          </label>
        </fieldset>

        {err && <p className="form-error">{err}</p>}

        <div className="modal-actions-split">
          <button type="button" className="topbar-btn" onClick={onClose} disabled={busy}>
            Huỷ
          </button>
          <button type="submit" className="topbar-btn primary" disabled={busy}>
            {busy ? "Đang export…" : "Export"}
          </button>
        </div>
      </form>
    </div>
  );
}
