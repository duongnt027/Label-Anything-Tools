import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, Box, imageUrl, Job } from "../api";
import AnnotationCanvas from "../components/AnnotationCanvas";
import { useAuth } from "../auth";
import AdminViewSwitcher from "../components/AdminViewSwitcher";
import { unlockJobOnLeave } from "../utils/jobLock";
import { isSegmentAnnotation } from "../utils/boxPayload";
import { parseTagDetails, serializeTagDetails } from "../utils/tagDetails";

type Stage2Box = Box & { image_source: string; img_id?: number };

const BOX_TAGS = ["Thừa box", "Sai class", "Sai OCR", "Sai Caption", "Sai segment", "Sai box_points"];
const DELETE_SKIP_CONFIRM_KEY = "la-review-s2-delete-no-ask";
/** Expand crop viewport around the box (context padding). */
const CROP_PAD = 1.75;

function parseBox(box_points: string) {
  const [xc, yc, w, h] = box_points.split(" ").map(Number);
  return { xc: xc || 0, yc: yc || 0, w: w || 0.01, h: h || 0.01 };
}

function paddedView(box_points: string) {
  const { xc, yc, w, h } = parseBox(box_points);
  const ww = Math.min(1, Math.max(0.001, w * CROP_PAD));
  const hh = Math.min(1, Math.max(0.001, h * CROP_PAD));
  const left = Math.max(0, Math.min(1 - ww, xc - ww / 2));
  const top = Math.max(0, Math.min(1 - hh, yc - hh / 2));
  return { xc: left + ww / 2, yc: top + hh / 2, w: ww, h: hh, box: { xc, yc, w, h } };
}

function parseSegment(segment_points: string): { x: number; y: number }[] {
  const parts = segment_points.trim().split(/\s+/).map(Number).filter((n) => !Number.isNaN(n));
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) pts.push({ x: parts[i], y: parts[i + 1] });
  return pts;
}

function cropStyle(box_points: string): CSSProperties {
  const { w: ww, h: hh, xc, yc } = paddedView(box_points);
  const left = xc - ww / 2;
  const top = yc - hh / 2;
  const posX = ww >= 1 ? 50 : (left / (1 - ww)) * 100;
  const posY = hh >= 1 ? 50 : (top / (1 - hh)) * 100;
  return {
    backgroundSize: `${(100 / ww).toFixed(2)}% ${(100 / hh).toFixed(2)}%`,
    backgroundPosition: `${posX.toFixed(2)}% ${posY.toFixed(2)}%`,
  };
}

function BoxOverlay({
  box_points,
  segment_points,
  compact,
}: {
  box_points: string;
  segment_points?: string;
  compact?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const segs = useMemo(() => parseSegment(segment_points || ""), [segment_points]);
  const view = useMemo(() => paddedView(box_points), [box_points]);
  const W = compact ? 110 : 214;
  const H = compact ? 88 : 170;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    const vLeft = view.xc - view.w / 2;
    const vTop = view.yc - view.h / 2;
    const toX = (nx: number) => ((nx - vLeft) / Math.max(0.001, view.w)) * W;
    const toY = (ny: number) => ((ny - vTop) / Math.max(0.001, view.h)) * H;
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 1.5;
    if (segs.length >= 2) {
      ctx.beginPath();
      segs.forEach((p, i) => {
        if (i === 0) ctx.moveTo(toX(p.x), toY(p.y));
        else ctx.lineTo(toX(p.x), toY(p.y));
      });
      ctx.closePath();
      ctx.stroke();
    } else {
      const b = view.box;
      const x = toX(b.xc - b.w / 2);
      const y = toY(b.yc - b.h / 2);
      ctx.strokeRect(x, y, (b.w / view.w) * W, (b.h / view.h) * H);
    }
  }, [segs, view, W, H]);

  return <canvas ref={canvasRef} className="review-s2-seg-overlay" width={W} height={H} />;
}

export default function ReviewStage2() {
  const { jobId } = useParams();
  const [search] = useSearchParams();
  const viewAs = search.get("view_as");
  const nav = useNavigate();
  const { user } = useAuth();
  const [job, setJob] = useState<Job | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [boxes, setBoxes] = useState<Stage2Box[]>([]);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  /** Which box has geometry handles focused in the expanded crop canvas. */
  const [shapeFocusId, setShapeFocusId] = useState<number | null>(null);
  /** Which selected tag's detail is being edited (within the expanded box). */
  const [detailTag, setDetailTag] = useState<string | null>(null);
  /** Compact card highlighted after delete — shows where to continue. */
  const [continueHintId, setContinueHintId] = useState<number | null>(null);
  const [deleteSkipConfirm, setDeleteSkipConfirm] = useState(() => {
    try {
      return localStorage.getItem(DELETE_SKIP_CONFIRM_KEY) === "1";
    } catch {
      return false;
    }
  });
  const scrollToBoxRef = useRef<number | null>(null);
  const selectedIdRef = useRef<number | null>(null);
  const canEditRef = useRef(canEdit);
  const boxesRef = useRef(boxes);
  const deleteSkipConfirmRef = useRef(deleteSkipConfirm);
  const [checkedIds, setCheckedIds] = useState<Set<number>>(() => new Set());
  selectedIdRef.current = selectedId;
  canEditRef.current = canEdit;
  boxesRef.current = boxes;
  deleteSkipConfirmRef.current = deleteSkipConfirm;

  const leaveDashboard = () => {
    unlockJobOnLeave(jobId);
    if (user?.role === "admin" && job?.task_id) {
      nav(`/admin/tasks/${job.task_id}?tab=jobs`);
      return;
    }
    nav(user?.role === "reviewer" ? "/reviewer" : "/annotator");
  };

  const adminView = search.get("admin_view");

  const load = () => {
    if (!jobId) return;
    const qs = new URLSearchParams();
    if (viewAs) qs.set("view_as", viewAs);
    else if (user?.role === "admin") qs.set("view_as", "reviewer");
    if (user?.role === "admin") qs.set("admin_view", adminView === "s2" || !adminView ? "s2" : adminView);
    api<{ job: Job; can_edit: boolean }>(`/api/jobs/${jobId}/open?${qs.toString()}`, {
      method: "POST",
    }).then((r) => {
      setJob(r.job);
      setCanEdit(r.can_edit);
    });
    api<Stage2Box[]>(`/api/jobs/${jobId}/stage2/boxes`).then(setBoxes);
  };

  useEffect(load, [jobId, viewAs, user?.role, adminView]);

  useEffect(() => {
    const valid = new Set(boxes.map((b) => b.id));
    setCheckedIds((prev) => {
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [boxes]);

  useEffect(() => {
    if (!jobId) return;
    const onUnload = () => unlockJobOnLeave(jobId);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      unlockJobOnLeave(jobId);
    };
  }, [jobId]);

  const byClass = useMemo(() => {
    const acc: Record<string, Stage2Box[]> = {};
    boxes.forEach((b) => {
      const k = b.class || "(no class)";
      (acc[k] ||= []).push(b);
    });
    return Object.entries(acc).sort(([a], [b]) => a.localeCompare(b, "vi"));
  }, [boxes]);

  const decided = boxes.filter((b) => b.status === "Accepted" || b.status === "Rejected").length;
  const progressPct = boxes.length ? Math.round((decided / boxes.length) * 100) : 0;

  const patchBox = useCallback(async (id: number, patch: object) => {
    if (!canEditRef.current) return;
    const updated = await api<Box>(`/api/images/boxes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    setBoxes((prev) => prev.map((b) => (b.id === id ? { ...b, ...updated } : b)));
  }, []);

  const deleteBox = useCallback(async (id: number) => {
    if (!canEditRef.current) return;
    if (
      !deleteSkipConfirmRef.current &&
      !window.confirm("Xóa box này? Annotator sẽ không còn thấy box.")
    ) {
      return;
    }
    const idx = boxesRef.current.findIndex((b) => b.id === id);
    const prevId = idx > 0 ? boxesRef.current[idx - 1].id : null;
    await api(`/api/images/boxes/${id}`, { method: "DELETE" });
    setBoxes((prev) => prev.filter((b) => b.id !== id));
    setCheckedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setSelectedId(null);
    setShapeFocusId(null);
    setDetailTag(null);
    if (prevId != null) {
      setContinueHintId(prevId);
      scrollToBoxRef.current = prevId;
    } else {
      setContinueHintId(null);
    }
  }, []);

  const toggleChecked = useCallback((id: number) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAllInClass = useCallback((list: Stage2Box[]) => {
    const ids = list.map((b) => b.id);
    setCheckedIds((prev) => {
      const allChecked = ids.length > 0 && ids.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allChecked) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  const deleteCheckedInClass = useCallback(async (list: Stage2Box[]) => {
    if (!canEditRef.current) return;
    const ids = list.filter((b) => checkedIds.has(b.id)).map((b) => b.id);
    if (!ids.length) return;
    if (
      !deleteSkipConfirmRef.current &&
      !window.confirm(`Xóa ${ids.length} box đã chọn? Annotator sẽ không còn thấy các box này.`)
    ) {
      return;
    }
    await Promise.all(ids.map((id) => api(`/api/images/boxes/${id}`, { method: "DELETE" })));
    const idSet = new Set(ids);
    setBoxes((prev) => prev.filter((b) => !idSet.has(b.id)));
    setCheckedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    if (selectedIdRef.current != null && idSet.has(selectedIdRef.current)) {
      setSelectedId(null);
      setShapeFocusId(null);
      setDetailTag(null);
    }
  }, [checkedIds]);

  const closeBox = useCallback((id: number) => {
    setContinueHintId(id);
    setSelectedId(null);
    setShapeFocusId(null);
    setDetailTag(null);
  }, []);

  useEffect(() => {
    const id = scrollToBoxRef.current;
    if (id == null || continueHintId !== id) return;
    scrollToBoxRef.current = null;
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-review-s2-box="${id}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, [continueHintId, boxes]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;

      const id = selectedIdRef.current;
      if (id == null) return;

      if (e.key === "Escape") {
        e.preventDefault();
        closeBox(id);
        return;
      }
      if (!canEditRef.current) return;

      const k = e.key.toLowerCase();
      if (e.key === "Delete" || k === "x") {
        e.preventDefault();
        void deleteBox(id);
      } else if (k === "a") {
        e.preventDefault();
        void patchBox(id, { status: "Accepted" });
      } else if (k === "r") {
        e.preventDefault();
        void patchBox(id, { status: "Rejected" });
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [closeBox, deleteBox, patchBox]);

  const selectBox = (id: number) => {
    if (selectedId === id) {
      closeBox(id);
      return;
    }
    setContinueHintId(null);
    setSelectedId(id);
    setShapeFocusId(id);
    setDetailTag(null);
  };

  const handleCropSelect = (boxId: number, id: number | null) => {
    if (id !== null) {
      setShapeFocusId(id);
      return;
    }
    if (shapeFocusId === boxId) {
      setShapeFocusId(null);
      return;
    }
    selectBox(boxId);
  };

  const toggleBoxTag = async (b: Stage2Box, tag: string) => {
    if (!canEdit) return;
    const adding = !b.tag.includes(tag);
    const next = adding ? [...b.tag, tag] : b.tag.filter((x) => x !== tag);
    const detailsMap = parseTagDetails(b.details);
    if (!adding) {
      delete detailsMap[tag];
      if (detailTag === tag) setDetailTag(null);
    } else {
      if (detailsMap[tag] == null) detailsMap[tag] = "";
      setDetailTag(tag);
    }
    await patchBox(b.id, { tag: next, details: serializeTagDetails(detailsMap) });
  };

  const setTagDetailLocal = (boxId: number, tag: string, text: string) => {
    setBoxes((prev) =>
      prev.map((x) => {
        if (x.id !== boxId) return x;
        const detailsMap = parseTagDetails(x.details);
        detailsMap[tag] = text;
        // Store raw JSON while typing so spaces are not lost.
        return { ...x, details: JSON.stringify(detailsMap) };
      }),
    );
  };

  const commitTagDetail = async (boxId: number, tag: string, text: string) => {
    const current = boxes.find((x) => x.id === boxId);
    const detailsMap = parseTagDetails(current?.details);
    detailsMap[tag] = text;
    const details = serializeTagDetails(detailsMap);
    setBoxes((prev) => prev.map((x) => (x.id === boxId ? { ...x, details } : x)));
    await patchBox(boxId, { details });
  };

  const finishAndLeave = async (accept: boolean) => {
    if (busy || !canEdit) return;
    setBusy(true);
    try {
      if (accept) {
        await api(`/api/jobs/${jobId}/review/stage2/submit`, { method: "POST" });
        const r = await api<Job>(`/api/jobs/${jobId}/accept`, { method: "POST" });
        if (r.state === "rejected") {
          alert("Job chuyển rejected vì vẫn còn box Rejected hoặc tag lỗi ảnh.");
        }
      } else {
        await api(`/api/jobs/${jobId}/reject`, { method: "POST" });
      }
      unlockJobOnLeave(jobId);
      leaveDashboard();
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : "Thao tác thất bại");
      setBusy(false);
    }
  };

  const scrollSummaryIntoView = (summary: HTMLElement) => {
    requestAnimationFrame(() => {
      summary.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  };

  return (
    <div className="annotate-root review-s2-root">
      <header className="anno-topbar review-s2-bar">
        <button type="button" className="topbar-btn anno-topbar-btn" onClick={leaveDashboard}>
          ← Dashboard
        </button>
        <div className="review-s2-bar-title">
          <span>Review Stage 2 — Job #{job?.task_job_id ?? jobId}</span>
          <span className="review-stage-badge">Stage 2</span>
          {!canEdit && <span className="lock-badge readonly">Chỉ xem</span>}
        </div>
        <div className="review-s2-bar-progress">
          <span>
            {decided} / {boxes.length}
          </span>
          <div className="anno-progress-track review-s2-progress-track">
            <div className="anno-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
        {jobId && <AdminViewSwitcher jobId={jobId} current="s2" />}
        <button
          type="button"
          className="topbar-btn primary"
          disabled={busy || !canEdit || boxes.length === 0}
          onClick={() => void finishAndLeave(true)}
          title="Tự Accept/Reject box còn lại → kết thúc job → về dashboard"
        >
          Submit stage 2
        </button>
      </header>

      <div className="review-s2-body pretty-scroll">
      <div className="review-s2-meta">
        <span>
          {canEdit
            ? "Click crop để mở review. Phím tắt (khi thẻ mở): Esc đóng · A accept · R reject · Delete/X xóa."
            : "Chế độ chỉ xem — không thể gắn tag hay kết thúc job."}
        </span>
        {canEdit && (
          <label className="review-s2-delete-skip">
            <input
              type="checkbox"
              checked={deleteSkipConfirm}
              onChange={() => {
                setDeleteSkipConfirm((v) => {
                  const next = !v;
                  try {
                    localStorage.setItem(DELETE_SKIP_CONFIRM_KEY, next ? "1" : "0");
                  } catch {
                    /* ignore */
                  }
                  return next;
                });
              }}
            />
            Delete won&apos;t ask
          </label>
        )}
      </div>

      {byClass.map(([cls, list]) => {
        const sectionChecked = list.filter((b) => checkedIds.has(b.id)).length;
        const allSectionChecked = list.length > 0 && sectionChecked === list.length;
        return (
        <details key={cls} className="review-s2-section" open>
          <summary
            onClick={(e) => scrollSummaryIntoView(e.currentTarget)}
          >
            <span className="review-s2-section-class-chip">{cls}</span>
            {canEdit && (
              <span
                className="review-s2-section-actions"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className="review-s2-section-btn"
                  onClick={() => toggleAllInClass(list)}
                  title={allSectionChecked ? "Bỏ chọn tất cả trong class" : "Chọn tất cả trong class"}
                >
                  {allSectionChecked ? "Bỏ chọn" : "Tick all"}
                </button>
                <button
                  type="button"
                  className="review-s2-section-btn review-s2-section-btn-danger"
                  disabled={sectionChecked === 0}
                  onClick={() => void deleteCheckedInClass(list)}
                  title="Xóa các box đã tick trong class này"
                >
                  Xóa đã chọn{sectionChecked > 0 ? ` (${sectionChecked})` : ""}
                </button>
              </span>
            )}
            <span className="review-s2-section-count">
              {list.length} annotation · {list.filter((b) => b.status !== "Unseen").length} đã quyết
            </span>
          </summary>
          <div className="review-s2-grid">
            {list.map((b) => {
              const imgId = b.img_id ?? 0;
              const src = imageUrl(imgId);
              const style = cropStyle(b.box_points || "0.5 0.5 0.1 0.1");
              const expanded = selectedId === b.id;
              const ticked = checkedIds.has(b.id);
              const detailsMap = parseTagDetails(b.details);
              const cropView = paddedView(b.box_points);
              return (
                <div
                  key={b.id}
                  data-review-s2-box={b.id}
                  className={`review-s2-card ${expanded ? "expanded" : "compact"} ${
                    ticked ? "checked" : ""
                  } ${continueHintId === b.id ? "continue-hint" : ""} ${
                    b.status === "Accepted" ? "accepted" : b.status === "Rejected" ? "rejected" : ""
                  }`}
                  onContextMenu={(e) => {
                    if (!canEdit) return;
                    e.preventDefault();
                    toggleChecked(b.id);
                  }}
                >
                  {canEdit && (
                    <input
                      type="checkbox"
                      className="jobs-tick review-s2-card-tick"
                      checked={ticked}
                      aria-label={`Chọn box #${b.id}`}
                      onChange={() => toggleChecked(b.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}
                  {!expanded ? (
                    <button
                      type="button"
                      className="review-s2-crop"
                      style={{
                        backgroundImage: `url('${src}')`,
                        backgroundRepeat: "no-repeat",
                        ...style,
                      }}
                      title={`box #${b.id} — click để review`}
                      onClick={() => selectBox(b.id)}
                    >
                      <BoxOverlay
                        box_points={b.box_points}
                        segment_points={b.segment_points}
                        compact
                      />
                      {b.tag.length > 0 && (
                        <span className="review-s2-compact-badge">{b.tag.length}</span>
                      )}
                    </button>
                  ) : canEdit ? (
                    <div className="review-s2-crop review-s2-crop-editable">
                      <button
                        type="button"
                        className="review-s2-crop-collapse"
                        title="Thu gọn"
                        onClick={() => selectBox(b.id)}
                      >
                        ×
                      </button>
                      <AnnotationCanvas
                        imageUrl={src}
                        imageId={imgId}
                        boxes={[b]}
                        selectedId={shapeFocusId === b.id ? b.id : null}
                        tool="hand"
                        disablePan
                        cropView={cropView}
                        interactionTarget="auto"
                        onSelect={(id) => handleCropSelect(b.id, id)}
                        onUpdateBox={(id, patch) => {
                          void patchBox(id, patch);
                        }}
                      />
                    </div>
                  ) : (
                    <div
                      className="review-s2-crop review-s2-crop-readonly"
                      style={{
                        backgroundImage: `url('${src}')`,
                        backgroundRepeat: "no-repeat",
                        ...style,
                      }}
                      title={`box #${b.id}`}
                    >
                      <button
                        type="button"
                        className="review-s2-crop-collapse"
                        title="Thu gọn"
                        onClick={() => selectBox(b.id)}
                      >
                        ×
                      </button>
                      <BoxOverlay
                        box_points={b.box_points}
                        segment_points={b.segment_points}
                        compact={false}
                      />
                    </div>
                  )}

                  {expanded && (
                    <div className="review-s2-expand">
                      <div className="review-s2-field">
                        <span className="review-s2-label">Loại</span>
                        <div className="review-s2-value">
                          {isSegmentAnnotation(b) ? "Segment" : "Box"}
                        </div>
                      </div>
                      <div className="review-s2-field">
                        <span className="review-s2-label">OCR</span>
                        <textarea
                          rows={2}
                          className="pretty-scroll review-s2-value-input"
                          lang="vi"
                          value={b.ocr_text || ""}
                          placeholder="Không có OCR"
                          disabled={!canEdit}
                          onChange={(e) => {
                            const v = e.target.value;
                            setBoxes((prev) =>
                              prev.map((x) => (x.id === b.id ? { ...x, ocr_text: v } : x)),
                            );
                          }}
                          onBlur={(e) => void patchBox(b.id, { ocr_text: e.target.value })}
                        />
                      </div>
                      <div className="review-s2-field">
                        <span className="review-s2-label">Caption</span>
                        <textarea
                          rows={2}
                          className="pretty-scroll review-s2-value-input"
                          lang="vi"
                          value={b.caption || ""}
                          placeholder="Không có caption"
                          disabled={!canEdit}
                          onChange={(e) => {
                            const v = e.target.value;
                            setBoxes((prev) =>
                              prev.map((x) => (x.id === b.id ? { ...x, caption: v } : x)),
                            );
                          }}
                          onBlur={(e) => void patchBox(b.id, { caption: e.target.value })}
                        />
                      </div>
                      <div className="review-s2-opts pretty-scroll">
                        {BOX_TAGS.map((t) => (
                          <button
                            key={t}
                            type="button"
                            className={`review-s2-opt ${t === "Thừa box" ? "bad" : ""} ${b.tag.includes(t) ? "sel" : ""}`}
                            disabled={!canEdit}
                            onClick={() => void toggleBoxTag(b, t)}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                      <div className="review-s2-field">
                        <span className="review-s2-label">Tag đã chọn</span>
                        <div className="review-s2-selected-tags pretty-scroll">
                          {b.tag.length === 0 && <span className="anno-muted">Chưa có tag</span>}
                          {b.tag.map((t) => (
                            <button
                              key={t}
                              type="button"
                              className={`anno-chip ${detailTag === t ? "active" : ""}`}
                              onClick={() => setDetailTag(detailTag === t ? null : t)}
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="review-s2-field">
                        <span className="review-s2-label">
                          Chi tiết tag{detailTag ? ` — ${detailTag}` : ""}
                        </span>
                        <textarea
                          rows={2}
                          className={`pretty-scroll review-s2-details ${!detailTag ? "is-idle" : ""}`}
                          lang="vi"
                          placeholder={
                            !detailTag
                              ? "Chọn một tag ở trên để ghi chi tiết"
                              : canEdit
                                ? `Mô tả cho tag ${detailTag}...`
                                : "Không thể chỉnh sửa"
                          }
                          value={detailTag ? detailsMap[detailTag] || "" : ""}
                          disabled={!canEdit || !detailTag}
                          onChange={(e) => {
                            if (!detailTag) return;
                            setTagDetailLocal(b.id, detailTag, e.target.value);
                          }}
                          onBlur={(e) => {
                            if (!detailTag) return;
                            void commitTagDetail(b.id, detailTag, e.target.value);
                          }}
                        />
                      </div>
                      <div className="review-s2-actions">
                        <button
                          type="button"
                          className={`review-s2-accept ${b.status === "Accepted" ? "on" : ""}`}
                          disabled={!canEdit}
                          onClick={() => void patchBox(b.id, { status: "Accepted" })}
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          className={`review-s2-reject ${b.status === "Rejected" ? "on" : ""}`}
                          disabled={!canEdit}
                          onClick={() => void patchBox(b.id, { status: "Rejected" })}
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          className="review-s2-delete"
                          title="Xóa box ngay (annotator không còn thấy)"
                          disabled={!canEdit}
                          onClick={() => void deleteBox(b.id)}
                        >
                          Xóa
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </details>
        );
      })}

      {boxes.length === 0 && (
        <div className="anno-muted review-s2-empty">
          Không có box từ ảnh đã Accept S1. Ảnh bị tag lỗi ở Stage 1 không vào Stage 2.
        </div>
      )}

      <div className="review-s2-finish">
        <button
          type="button"
          className="topbar-btn primary"
          disabled={busy || !canEdit}
          onClick={() => void finishAndLeave(true)}
          title="Tự Accept/Reject box còn lại → kết thúc job → về dashboard"
        >
          Finish review
        </button>
        <button
          type="button"
          className="topbar-btn"
          disabled={busy || !canEdit}
          onClick={() => void finishAndLeave(false)}
        >
          Reject job
        </button>
      </div>
      </div>
    </div>
  );
}
