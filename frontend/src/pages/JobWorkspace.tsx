import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, Box, imageUrl, Job, LaImage } from "../api";
import { useAuth } from "../auth";
import AnnotationCanvas from "../components/AnnotationCanvas";

const IMAGE_ERROR_TAGS = ["Thiếu box", "Thừa box", "Sai Caption"];

export default function JobWorkspace() {
  const { jobId } = useParams();
  const [search] = useSearchParams();
  const mode = search.get("mode");
  const viewAs = search.get("view_as");
  const nav = useNavigate();
  const { user } = useAuth();
  const [job, setJob] = useState<Job | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [images, setImages] = useState<LaImage[]>([]);
  const [idx, setIdx] = useState(0);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [selectedBox, setSelectedBox] = useState<number | null>(null);
  const [tool, setTool] = useState<"box" | "hand">("box");
  const [taskClasses, setTaskClasses] = useState<string[]>([]);
  const [newClass, setNewClass] = useState("");

  const current = images[idx];
  const isReview = mode === "review";
  const isAnnotatorWorkspace = !isReview && (user?.role === "annotator" || viewAs === "annotator");

  useEffect(() => {
    if (!jobId) return;
    const qs = new URLSearchParams();
    if (viewAs) qs.set("view_as", viewAs);
    api<{ job: Job; can_edit: boolean; task_classes: string[] }>(
      `/api/jobs/${jobId}/open?${qs.toString()}`,
      { method: "POST" },
    ).then((r) => {
      setJob(r.job);
      setCanEdit(r.can_edit);
      setTaskClasses(r.task_classes || []);
    });
    api<LaImage[]>(`/api/jobs/${jobId}/images`).then(setImages);
  }, [jobId, viewAs]);

  useEffect(() => {
    if (!current || !jobId) return;
    api<Box[]>(`/api/jobs/${jobId}/images/${current.id}/boxes`).then(setBoxes);
    api<{ job: Job }>(`/api/jobs/${jobId}/view-image/${current.id}`, { method: "POST" }).then((r) =>
      setJob(r.job),
    );
  }, [current?.id, jobId]);

  const classesInImage = useMemo(() => [...new Set(boxes.map((b) => b.class).filter(Boolean))], [boxes]);

  const reloadBoxes = () => {
    if (!current || !jobId) return;
    api<Box[]>(`/api/jobs/${jobId}/images/${current.id}/boxes`).then(setBoxes);
  };

  const addBox = async (points: string) => {
    if (!current || !canEdit || isReview) return;
    const cls = selectedBox ? boxes.find((b) => b.id === selectedBox)?.class : taskClasses[0] || "default";
    try {
      await api(`/api/images/${current.id}/boxes`, {
        method: "POST",
        body: JSON.stringify({
          class: cls || "default",
          box_points: points,
        }),
      });
      reloadBoxes();
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : "Không thêm được box");
    }
  };

  const updateSelected = async (patch: Partial<Box>) => {
    if (!selectedBox || !canEdit) return;
    await api(`/api/images/boxes/${selectedBox}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    reloadBoxes();
  };

  const submitJob = async () => {
    if (!submitEnabled || !canEdit) return;
    try {
      await api(`/api/jobs/${jobId}/submit`, { method: "POST" });
      nav("/annotator");
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : "Submit thất bại");
    }
  };

  const continueS1 = async () => {
    await api(`/api/jobs/${jobId}/review/stage1/continue`, { method: "POST" });
    nav(`/jobs/${jobId}/review-s2`);
  };

  const toggleImageTag = async (tag: string) => {
    if (!current || !canEdit) return;
    const tags = current.tag.includes(tag) ? current.tag.filter((t) => t !== tag) : [...current.tag, tag];
    const updated = await api<LaImage>(`/api/images/${current.id}`, {
      method: "PATCH",
      body: JSON.stringify({ tag: tags }),
    });
    setImages((imgs) => imgs.map((im) => (im.id === updated.id ? updated : im)));
  };

  const removeTag = async (tag: string) => {
    if (!current) return;
    const updated = await api<LaImage>(`/api/images/${current.id}/tags/${encodeURIComponent(tag)}`, {
      method: "DELETE",
    });
    setImages((imgs) => imgs.map((im) => (im.id === updated.id ? updated : im)));
  };

  const addGolden = async () => {
    if (!current) return;
    await api(`/api/images/${current.id}/golden-pool`, { method: "POST" });
    alert("Đã thêm vào golden pool");
  };

  const goPrev = () => setIdx((i) => Math.max(0, i - 1));
  const goNext = () => setIdx((i) => Math.min(images.length - 1, i + 1));

  if (!job || !current) {
    return (
      <div className="annotate-root" style={{ padding: "2rem", color: "var(--text-muted)" }}>
        Đang tải job...
      </div>
    );
  }

  const submitEnabled = job.annotator_process >= job.img_num && job.img_num > 0;
  const reviewContinueEnabled = job.review_s1_process >= job.img_num;
  const imagePct = images.length ? Math.round(((idx + 1) / images.length) * 100) : 0;
  const fileName = current.filename || current.image_source.split("/").pop() || "";

  const submitBtn = (
    <button
      type="button"
      className={`topbar-btn primary ${submitEnabled ? "submit-ready" : ""}`}
      disabled={!submitEnabled || !canEdit}
      onClick={submitJob}
      title={
        !canEdit
          ? "Job đang bị lock — không submit được"
          : !submitEnabled
            ? "Xem hết ảnh trong job trước khi submit"
            : "Gửi job cho reviewer"
      }
    >
      Submit job
    </button>
  );

  return (
    <div className="annotate-root">
      <header className="topbar">
        <div className="topbar-group">
          <button type="button" className="topbar-btn" onClick={() => nav(user?.role === "reviewer" ? "/reviewer" : "/annotator")}>
            ← Dashboard
          </button>
          <span className="topbar-meta">
            Job #{job.id} · {fileName}
          </span>
        </div>
        <div className="topbar-spacer" />
        {!canEdit && (
          <span className="lock-badge readonly">Chỉ xem — job đang bị lock</span>
        )}
        {canEdit && isAnnotatorWorkspace && (
          <span className="lock-badge mine">Đang chỉnh sửa</span>
        )}
        <div className="topbar-group">
          <button type="button" className="topbar-btn" onClick={goPrev} disabled={idx === 0}>
            Previous
          </button>
          <button type="button" className="topbar-btn" onClick={goNext} disabled={idx >= images.length - 1}>
            Next
          </button>
          {user?.role === "admin" && (
            <button type="button" className="topbar-btn" onClick={addGolden}>
              + Golden
            </button>
          )}
          {isAnnotatorWorkspace && submitBtn}
          {isReview && job.review_stage === 1 && (
            <button
              type="button"
              className={`topbar-btn primary ${reviewContinueEnabled ? "submit-ready" : ""}`}
              disabled={!reviewContinueEnabled || !canEdit}
              onClick={continueS1}
            >
              Continue S2
            </button>
          )}
        </div>
      </header>

      <div className="image-progress-bar">
        <label>
          Ảnh {idx + 1}/{images.length} ({imagePct}%) · Job {job.annotator_process}/{job.img_num}
        </label>
        <input
          type="range"
          min={0}
          max={Math.max(0, images.length - 1)}
          value={idx}
          onChange={(e) => setIdx(+e.target.value)}
        />
      </div>

      <div className="annotate-grid">
        {/* Trái — classes, boxes, Submit (ui.md) */}
        <aside className="annotate-panel">
          <div className="panel-section-title">Classes trong ảnh</div>
          {classesInImage.length === 0 && <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>—</p>}
          {classesInImage.map((c) => (
            <span key={c} className="tag-chip">
              {c}
            </span>
          ))}

          <div className="panel-section-title">Boxes ({boxes.length})</div>
          {boxes.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`box-list-btn ${selectedBox === b.id ? "selected" : ""}`}
              onClick={() => setSelectedBox(b.id)}
            >
              #{b.id} · {b.class || "(no class)"}
            </button>
          ))}

          {isAnnotatorWorkspace && (
            <div className="submit-sticky">
              {submitBtn}
              {!submitEnabled && (
                <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0.35rem 0 0" }}>
                  Xem hết {job.img_num} ảnh để bật Submit ({job.annotator_process}/{job.img_num})
                </p>
              )}
            </div>
          )}

          <div className="panel-section-title">Image tags</div>
          {current.tag.map((t) => (
            <span key={t} className="tag-chip">
              {t}
              {canEdit && isAnnotatorWorkspace && (
                <button type="button" onClick={() => removeTag(t)}>
                  ×
                </button>
              )}
            </span>
          ))}

          {isReview && canEdit && (
            <div style={{ marginTop: "0.35rem" }}>
              {IMAGE_ERROR_TAGS.map((t) => (
                <button key={t} type="button" className="topbar-btn" style={{ margin: 2 }} onClick={() => toggleImageTag(t)}>
                  {t}
                </button>
              ))}
            </div>
          )}

          <div className="panel-section-title">Box tags</div>
          {boxes.flatMap((b) =>
            b.tag.map((t) => (
              <button
                key={`${b.id}-${t}`}
                type="button"
                className="tag-chip"
                onClick={() => setSelectedBox(b.id)}
              >
                #{b.id}: {t}
              </button>
            )),
          )}
        </aside>

        {/* Giữa — canvas */}
        <div className="canvas-panel">
          <div className="canvas-stage-wrap">
            <AnnotationCanvas
              imageUrl={imageUrl(current.id)}
              boxes={boxes}
              selectedId={selectedBox}
              tool={tool}
              readOnly={!canEdit || isReview}
              onSelect={setSelectedBox}
              onCreateBox={addBox}
            />
          </div>
          <footer className="caption-bar">
            <div className="tool-group">
              <button
                type="button"
                className={`topbar-btn ${tool === "box" ? "active" : ""}`}
                onClick={() => setTool("box")}
                disabled={!canEdit || isReview}
              >
                Bbox (B)
              </button>
              <button
                type="button"
                className={`topbar-btn ${tool === "hand" ? "active" : ""}`}
                onClick={() => setTool("hand")}
              >
                Pan (H)
              </button>
            </div>
            <div className="caption-fields">
              <div>
                <label>Image Caption</label>
                <textarea
                  rows={2}
                  value={current.caption || ""}
                  disabled={!canEdit || isReview}
                  onChange={async (e) => {
                    const updated = await api<LaImage>(`/api/images/${current.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({ caption: e.target.value }),
                    });
                    setImages((imgs) => imgs.map((im) => (im.id === updated.id ? updated : im)));
                  }}
                />
              </div>
              {selectedBox && (
                <>
                  <div>
                    <label>Bbox Caption</label>
                    <input
                      value={boxes.find((b) => b.id === selectedBox)?.caption || ""}
                      disabled={!canEdit || isReview}
                      onChange={(e) => updateSelected({ caption: e.target.value })}
                    />
                  </div>
                  <div>
                    <label>Bbox Class</label>
                    <input
                      list="class-suggestions"
                      value={boxes.find((b) => b.id === selectedBox)?.class || ""}
                      disabled={!canEdit || isReview}
                      onChange={(e) => updateSelected({ class: e.target.value })}
                    />
                    <datalist id="class-suggestions">
                      {taskClasses.map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                  </div>
                </>
              )}
            </div>
            {!isReview && canEdit && (
              <div style={{ minWidth: 140 }}>
                <label style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>Thêm class task</label>
                <div style={{ display: "flex", gap: 4 }}>
                  <input placeholder="Class" value={newClass} onChange={(e) => setNewClass(e.target.value)} />
                  <button
                    type="button"
                    className="topbar-btn"
                    onClick={async () => {
                      await api(`/api/tasks/${job.task_id}/classes?class_name=${encodeURIComponent(newClass)}`, {
                        method: "POST",
                      });
                      setTaskClasses((c) => [...c, newClass]);
                      setNewClass("");
                    }}
                  >
                    +
                  </button>
                </div>
              </div>
            )}
          </footer>
        </div>

        {/* Phải — danh sách ảnh (ui.md) */}
        <aside className="annotate-panel right">
          <div className="panel-section-title">Images ({images.length})</div>
          {images.map((im, i) => (
            <button
              key={im.id}
              type="button"
              className={`image-list-item ${i === idx ? "active" : ""}`}
              onClick={() => setIdx(i)}
            >
              <span
                className={`dot ${
                  im.status === "Accepted" ? "accepted" : im.status === "Rejected" ? "rejected" : "unseen"
                }`}
              />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                {im.filename || im.image_source.split("/").pop()}
              </span>
            </button>
          ))}
        </aside>
      </div>
    </div>
  );
}
