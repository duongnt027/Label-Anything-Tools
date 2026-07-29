import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { api, Box, imageUrl, Job, LaImage } from "../api";
import AnnotationCanvas from "../components/AnnotationCanvas";
import {
  commitImageTagDetails,
  mergeImageDetailsMeta,
  parseTagDetails,
  splitImageDetailsMeta,
} from "../utils/tagDetails";

const IMAGE_ERROR_TAGS = ["Thiếu box", "Sai Caption"];
const ACCEPT_TAGS = new Set(["Accept S1", "Accept All"]);
const UNIFORM_STROKE = "#38bdf8";

type Props = {
  job: Job;
  jobId: string;
  images: LaImage[];
  canEdit: boolean;
  lockedByUsername?: string | null;
  onBack: () => void;
  onImagesChange: (updater: (imgs: LaImage[]) => LaImage[]) => void;
  onJobChange: (job: Job) => void;
  onContinueS2: () => void | Promise<void>;
  headerAfterProgress?: ReactNode;
  /** Initial frame after resume prompt (0-based). */
  bootIndex?: number;
  /** When false, defer loading boxes / view_image until user picks resume. */
  workspaceReady?: boolean;
};

export default function ReviewStage1({
  job,
  jobId,
  images,
  canEdit,
  lockedByUsername,
  onBack,
  onImagesChange,
  onJobChange,
  onContinueS2,
  headerAfterProgress,
  bootIndex = 0,
  workspaceReady = true,
}: Props) {
  const [idx, setIdx] = useState(0);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [busy, setBusy] = useState(false);
  const [detailTag, setDetailTag] = useState<string | null>(null);
  const imageListRef = useRef<HTMLDivElement>(null);
  const bootSyncedRef = useRef(false);

  useEffect(() => {
    if (!workspaceReady) bootSyncedRef.current = false;
  }, [workspaceReady]);

  useEffect(() => {
    if (!workspaceReady || !images.length) return;
    if (bootSyncedRef.current) return;
    bootSyncedRef.current = true;
    const start = Math.min(Math.max(0, bootIndex), images.length - 1);
    setIdx(start);
  }, [workspaceReady, images.length, bootIndex]);

  const needsStage1 = useMemo(
    () => images.some((im) => im.status === "Unseen" || im.status === "Rejected"),
    [images],
  );

  const current = images[idx];
  const imagePct = images.length ? Math.round(((idx + 1) / images.length) * 100) : 0;
  const onLastImage = images.length > 0 && idx >= images.length - 1;
  const viewedAll = job.review_s1_process >= job.img_num && job.img_num > 0;
  const continueLit = Boolean(canEdit && (needsStage1 ? onLastImage && viewedAll : true));

  const fileName = current
    ? current.filename || current.image_source.split("/").pop() || `image-${current.id}`
    : "";

  const selectedTags = current?.tag || [];
  const negativeTags = useMemo(
    () => selectedTags.filter((t) => IMAGE_ERROR_TAGS.includes(t)),
    [selectedTags],
  );
  const detailsMap = useMemo(() => parseTagDetails(current?.details), [current?.details]);
  const hasAcceptLock = selectedTags.some((t) => ACCEPT_TAGS.has(t));
  const availableTags = IMAGE_ERROR_TAGS.filter((t) => !selectedTags.includes(t));

  useEffect(() => {
    setDetailTag(null);
  }, [current?.id]);

  useEffect(() => {
    if (detailTag && !negativeTags.includes(detailTag)) setDetailTag(null);
  }, [detailTag, negativeTags]);

  useEffect(() => {
    if (!workspaceReady) return;
    if (!needsStage1 && images.length) {
      setIdx(Math.max(0, images.length - 1));
    }
  }, [needsStage1, images.length, workspaceReady]);

  useEffect(() => {
    if (!workspaceReady || !current || !jobId) return;
    let cancelled = false;
    api<Box[]>(`/api/jobs/${jobId}/images/${current.id}/boxes`).then((b) => {
      if (!cancelled) setBoxes(b);
    });
    api<{ job: Job }>(`/api/jobs/${jobId}/view-image/${current.id}`, { method: "POST" }).then((r) => {
      if (!cancelled) onJobChange(r.job);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, jobId, workspaceReady]);

  useEffect(() => {
    const el = imageListRef.current?.querySelector<HTMLElement>(`[data-img-idx="${idx}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [idx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (e.key === "ArrowLeft" || k === "d") {
        e.preventDefault();
        setIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "ArrowRight" || k === "f") {
        e.preventDefault();
        setIdx((i) => Math.min(images.length - 1, i + 1));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [images.length]);

  const patchImage = async (patch: { tag?: string[]; details?: string; caption?: string }) => {
    if (!current || !canEdit) return null;
    const updated = await api<LaImage>(`/api/images/${current.id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    onImagesChange((imgs) => imgs.map((im) => (im.id === updated.id ? updated : im)));
    return updated;
  };

  const addImageTag = async (tag: string) => {
    if (!current || !canEdit) return;
    if (hasAcceptLock) {
      alert("Xóa Accept S1 / Accept All trước khi thêm tag lỗi.");
      return;
    }
    if (current.tag.includes(tag)) return;
    const detailsMapNext = parseTagDetails(current.details);
    if (detailsMapNext[tag] == null) detailsMapNext[tag] = "";
    setDetailTag(tag);
    await patchImage({
      tag: [...current.tag, tag],
      details: commitImageTagDetails(current.details, detailsMapNext),
    });
  };

  const removeImageTag = async (tag: string) => {
    if (!current || !canEdit) return;
    const detailsMapNext = parseTagDetails(current.details);
    delete detailsMapNext[tag];
    if (detailTag === tag) setDetailTag(null);
    await patchImage({
      tag: current.tag.filter((t) => t !== tag),
      details: commitImageTagDetails(current.details, detailsMapNext),
    });
  };

  const setTagDetailLocal = (tag: string, text: string) => {
    if (!current) return;
    onImagesChange((imgs) =>
      imgs.map((im) => {
        if (im.id !== current.id) return im;
        const map = parseTagDetails(im.details);
        map[tag] = text;
        const { goldenSuffix } = splitImageDetailsMeta(im.details);
        return { ...im, details: mergeImageDetailsMeta(JSON.stringify(map), goldenSuffix) };
      }),
    );
  };

  const commitTagDetail = async (tag: string, text: string) => {
    if (!current || !canEdit) return;
    const map = parseTagDetails(current.details);
    map[tag] = text;
    const details = commitImageTagDetails(current.details, map);
    onImagesChange((imgs) => imgs.map((im) => (im.id === current.id ? { ...im, details } : im)));
    await patchImage({ details });
  };

  const continueS2 = async () => {
    if (!continueLit || busy) return;
    setBusy(true);
    try {
      await onContinueS2();
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : "Không tiếp tục được Stage 2");
    } finally {
      setBusy(false);
    }
  };

  if (!current) {
    return (
      <div className="annotate-root">
        <div className="annotate-loading">Đang tải...</div>
      </div>
    );
  }

  return (
    <div className="annotate-root review-s1-root">
      <header className="anno-topbar">
        <div className="anno-topbar-left">
          <button type="button" className="topbar-btn anno-topbar-btn" onClick={onBack} title="Quay lại">
            ←
          </button>
          <span className="anno-filename" title={fileName}>
            {fileName}
          </span>
          {lockedByUsername && (
            <span className={`lock-badge ${canEdit ? "mine" : "readonly"}`}>
              {canEdit ? `Lock: ${lockedByUsername}` : `Đang khóa: ${lockedByUsername}`}
            </span>
          )}
          <span className="review-stage-badge">Stage 1</span>
        </div>
        <div className="anno-topbar-center">
          <div className="anno-progress">
            <span className="anno-progress-pos">
              {idx + 1}/{images.length}
            </span>
            <div className="anno-progress-track">
              <div className="anno-progress-fill" style={{ width: `${imagePct}%` }} />
              <input
                className="anno-progress-range"
                type="range"
                min={0}
                max={Math.max(0, images.length - 1)}
                value={idx}
                onChange={(e) => setIdx(Number(e.target.value))}
              />
            </div>
            <span className="anno-progress-pct">{imagePct}%</span>
          </div>
          {headerAfterProgress}
        </div>
        <div className="anno-topbar-right">
          <button
            type="button"
            className="topbar-btn anno-topbar-btn"
            disabled={idx <= 0}
            onClick={() => setIdx((i) => Math.max(0, i - 1))}
            title="Ảnh trước (D)"
          >
            D
          </button>
          <button
            type="button"
            className="topbar-btn anno-topbar-btn"
            disabled={idx >= images.length - 1}
            onClick={() => setIdx((i) => Math.min(images.length - 1, i + 1))}
            title="Ảnh sau (F)"
          >
            F
          </button>
          <button
            type="button"
            className={`topbar-btn anno-topbar-btn primary ${continueLit ? "submit-ready" : ""}`}
            disabled={!continueLit || busy}
            onClick={() => void continueS2()}
            title={
              !needsStage1
                ? "Tất cả ảnh đã qua Stage 1 — tiếp tục Stage 2"
                : !onLastImage
                  ? "Chỉ Continue ở ảnh cuối"
                  : !viewedAll
                    ? "Cần xem hết các ảnh"
                    : "Continue Stage 2"
            }
          >
            Continue S2
          </button>
        </div>
      </header>

      <div className="annotate-grid review-s1-grid">
        <aside className="annotate-panel left">
          <div className="panel-section-title">Images</div>
          <div className="anno-image-list pretty-scroll" ref={imageListRef}>
            {images.map((im, i) => {
              const name = im.filename || im.image_source.split("/").pop() || `image-${im.id}`;
              return (
                <button
                  key={im.id}
                  type="button"
                  data-img-idx={i}
                  className={`anno-image-row ${i === idx ? "active" : ""}`}
                  onClick={() => setIdx(i)}
                >
                  <span
                    className={`dot ${
                      im.status === "Accepted"
                        ? "accepted"
                        : im.status === "Rejected"
                          ? "rejected"
                          : "unseen"
                    }`}
                  />
                  <span className="anno-image-row-name">{name}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="annotate-main review-s1-canvas-panel">
          <div className="canvas-stage-wrap">
            <AnnotationCanvas
              imageUrl={imageUrl(current.id)}
              boxes={boxes}
              selectedId={null}
              tool="hand"
              readOnly
              classOrder={[]}
              uniformStrokeColor={UNIFORM_STROKE}
              onSelect={() => {}}
            />
          </div>
          <footer className="review-s1-footer">
            <div className="anno-field">
              <label>Image caption</label>
              <textarea
                rows={2}
                className="pretty-scroll review-s1-caption"
                lang="vi"
                value={current.caption || ""}
                placeholder={canEdit ? "Nhập caption ảnh..." : "Không thể chỉnh sửa"}
                disabled={!canEdit}
                onChange={async (e) => {
                  const updated = await api<LaImage>(`/api/images/${current.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ caption: e.target.value }),
                  });
                  onImagesChange((imgs) => imgs.map((im) => (im.id === updated.id ? updated : im)));
                }}
              />
            </div>
            <div className="review-s1-tags">
              <div className="panel-section-title">Image tags</div>
              <div className="review-s1-tag-split">
                <div className="review-s1-tag-pane selected">
                  <div className="review-s1-tag-pane-title">Đã chọn</div>
                  <div className="anno-chip-row pretty-scroll">
                    {selectedTags.length === 0 && <span className="anno-muted">—</span>}
                    {selectedTags.map((t) => (
                      <span key={t} className="anno-chip with-x active">
                        <span className="anno-chip-label">{t}</span>
                        <button
                          type="button"
                          className="anno-chip-x"
                          title="Xóa tag"
                          disabled={!canEdit}
                          onClick={() => void removeImageTag(t)}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
                <div className={`review-s1-tag-pane available ${hasAcceptLock ? "locked" : ""}`}>
                  <div className="review-s1-tag-pane-title">
                    Khả dụng
                    {hasAcceptLock && <span className="review-s1-tag-lock-hint"> (xóa Accept trước)</span>}
                  </div>
                  <div className="anno-chip-row pretty-scroll">
                    {!canEdit && <span className="anno-muted">Chỉ xem</span>}
                    {canEdit && availableTags.length === 0 && (
                      <span className="anno-muted">{hasAcceptLock ? "Đang khóa bởi Accept" : "—"}</span>
                    )}
                    {canEdit &&
                      availableTags.map((t) => (
                        <button
                          key={t}
                          type="button"
                          className="anno-chip"
                          disabled={hasAcceptLock}
                          onClick={() => void addImageTag(t)}
                        >
                          {t}
                        </button>
                      ))}
                  </div>
                </div>
              </div>
              <div className="review-s2-field" style={{ marginTop: 8 }}>
                <span className="review-s2-label">Tag lỗi đã chọn</span>
                <div className="review-s2-selected-tags pretty-scroll">
                  {negativeTags.length === 0 && <span className="anno-muted">Chưa có tag lỗi</span>}
                  {negativeTags.map((t) => (
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
                      ? "Chọn một tag lỗi ở trên để ghi chi tiết"
                      : canEdit
                        ? `Mô tả cho tag ${detailTag}...`
                        : "Không thể chỉnh sửa"
                  }
                  value={detailTag ? detailsMap[detailTag] || "" : ""}
                  disabled={!canEdit || !detailTag}
                  onChange={(e) => {
                    if (!detailTag) return;
                    setTagDetailLocal(detailTag, e.target.value);
                  }}
                  onBlur={(e) => {
                    if (!detailTag) return;
                    void commitTagDetail(detailTag, e.target.value);
                  }}
                />
              </div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
