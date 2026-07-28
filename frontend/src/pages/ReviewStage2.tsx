import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, Box, imageUrl, Job } from "../api";
import { useAuth } from "../auth";
import AdminViewSwitcher from "../components/AdminViewSwitcher";
import { unlockJobOnLeave } from "../utils/jobLock";
import { parseTagDetails, serializeTagDetails } from "../utils/tagDetails";

type Stage2Box = Box & { image_source: string; img_id?: number };

const BOX_TAGS = ["Thừa box", "Sai class", "Sai OCR", "Sai Caption", "Sai segment", "Sai box_points"];
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
  /** Which selected tag's detail is being edited (within the expanded box). */
  const [detailTag, setDetailTag] = useState<string | null>(null);

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

  const patchBox = async (id: number, patch: object) => {
    if (!canEdit) return;
    const updated = await api<Box>(`/api/images/boxes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    setBoxes((prev) => prev.map((b) => (b.id === id ? { ...b, ...updated } : b)));
  };

  const deleteBox = async (id: number) => {
    if (!canEdit) return;
    if (!window.confirm("Xóa box này? Annotator sẽ không còn thấy box.")) return;
    await api(`/api/images/boxes/${id}`, { method: "DELETE" });
    setBoxes((prev) => prev.filter((b) => b.id !== id));
    if (selectedId === id) {
      setSelectedId(null);
      setDetailTag(null);
    }
  };

  const selectBox = (id: number) => {
    if (selectedId === id) {
      setSelectedId(null);
      setDetailTag(null);
      return;
    }
    setSelectedId(id);
    setDetailTag(null);
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

  /** Auto-resolve remaining boxes, then accept/reject job and leave. */
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

  return (
    <div className="review-s2-root pretty-scroll">
      <div className="review-s2-bar">
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
      </div>

      <div className="review-s2-meta">
        {canEdit
          ? "Chỉ ảnh đã Accept S1 mới hiện ở đây. Click crop để mở review; mỗi tag có ô mô tả riêng."
          : "Chế độ chỉ xem — không thể gắn tag hay kết thúc job."}
      </div>

      {byClass.map(([cls, list]) => (
        <details key={cls} className="review-s2-section" open>
          <summary>
            <b>{cls}</b>
            <span className="review-s2-section-count">
              {list.length} box · {list.filter((b) => b.status !== "Unseen").length} đã quyết
            </span>
          </summary>
          <div className="review-s2-grid">
            {list.map((b) => {
              const imgId = b.img_id ?? 0;
              const src = imageUrl(imgId);
              const style = cropStyle(b.box_points || "0.5 0.5 0.1 0.1");
              const expanded = selectedId === b.id;
              const detailsMap = parseTagDetails(b.details);
              return (
                <div
                  key={b.id}
                  className={`review-s2-card ${expanded ? "expanded" : "compact"} ${
                    b.status === "Accepted" ? "accepted" : b.status === "Rejected" ? "rejected" : ""
                  }`}
                >
                  <button
                    type="button"
                    className="review-s2-crop"
                    style={{
                      backgroundImage: `url('${src}')`,
                      backgroundRepeat: "no-repeat",
                      ...style,
                    }}
                    title={`box #${b.id} — click để ${expanded ? "thu gọn" : "review"}`}
                    onClick={() => selectBox(b.id)}
                  >
                    <BoxOverlay
                      box_points={b.box_points}
                      segment_points={b.segment_points}
                      compact={!expanded}
                    />
                    {!expanded && b.tag.length > 0 && (
                      <span className="review-s2-compact-badge">{b.tag.length}</span>
                    )}
                  </button>

                  {expanded && (
                    <div className="review-s2-expand">
                      <div className="review-s2-field">
                        <span className="review-s2-label">OCR</span>
                        <div
                          className={`review-s2-value pretty-scroll ${b.ocr_text?.trim() ? "" : "is-placeholder"}`}
                        >
                          {b.ocr_text?.trim() || "Không có OCR"}
                        </div>
                      </div>
                      <div className="review-s2-field">
                        <span className="review-s2-label">Caption</span>
                        <div
                          className={`review-s2-value pretty-scroll ${b.caption?.trim() ? "" : "is-placeholder"}`}
                        >
                          {b.caption?.trim() || "Không có caption"}
                        </div>
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
      ))}

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
  );
}
