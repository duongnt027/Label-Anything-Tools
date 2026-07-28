import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { api, Box, imageUrl, LaImage } from "../api";
import AnnotationCanvas, { AnnotateTool } from "./AnnotationCanvas";
import { ClassCombobox } from "./ClassCombobox";
import { IconBox, IconDiamond, IconEye, IconEyeOff, IconHand, IconSegment } from "./icons";
import { buildClassColorIndex, classColorForName, classContrastText } from "../utils/classColors";
import { parseTagDetails } from "../utils/tagDetails";

const IMAGE_ERROR_TAGS = ["Thiếu box", "Thừa box", "Sai Caption"];

type FocusField = "imageCaption" | "boxCaption" | "ocr" | "class" | null;

type Props = {
  mode: "job" | "golden";
  images: LaImage[];
  idx: number;
  onIdxChange: (i: number) => void;
  boxes: Box[];
  onReloadBoxes: () => void;
  onBoxesChange?: (updater: (boxes: Box[]) => Box[]) => void;
  taskId: number;
  taskClasses: string[];
  onTaskClassesChange: (classes: string[]) => void;
  canEdit: boolean;
  lockedByUsername?: string | null;
  showSubmit?: boolean;
  submitEnabled?: boolean;
  onSubmit?: () => void;
  showContinueS1?: boolean;
  continueEnabled?: boolean;
  onContinueS1?: () => void;
  isReview?: boolean;
  onBack: () => void;
  onImagesChange: (updater: (imgs: LaImage[]) => LaImage[]) => void;
  showGoldenToggle?: boolean;
  /** Rendered in topbar after the progress bar (e.g. admin view switcher). */
  headerAfterProgress?: ReactNode;
};

export default function AnnotationScreen({
  mode,
  images,
  idx,
  onIdxChange,
  boxes,
  onReloadBoxes,
  onBoxesChange,
  taskId,
  taskClasses,
  onTaskClassesChange,
  canEdit,
  lockedByUsername,
  showSubmit,
  submitEnabled,
  onSubmit,
  showContinueS1,
  continueEnabled,
  onContinueS1,
  isReview,
  onBack,
  onImagesChange,
  showGoldenToggle,
  headerAfterProgress,
}: Props) {
  const current = images[idx];
  const [selectedBox, setSelectedBox] = useState<number | null>(null);
  const [tool, setTool] = useState<AnnotateTool>("box");
  const [defaultDrawClass, setDefaultDrawClass] = useState<string>("");
  /** Most-recently-used class order (newest first). */
  const [classMru, setClassMru] = useState<string[]>([]);
  const [activeImageTag, setActiveImageTag] = useState<string | null>(null);
  const [activeBoxTagKey, setActiveBoxTagKey] = useState<string | null>(null);
  const [expandedBoxTag, setExpandedBoxTag] = useState<string | null>(null);
  const [goldenMarked, setGoldenMarked] = useState(false);
  const [copiedFlash, setCopiedFlash] = useState(false);
  const [focusField, setFocusField] = useState<FocusField>(null);
  const [hiddenBoxIds, setHiddenBoxIds] = useState<Set<number>>(() => new Set());

  const imageListRef = useRef<HTMLDivElement>(null);
  const imageCaptionRef = useRef<HTMLTextAreaElement>(null);
  const boxCaptionRef = useRef<HTMLTextAreaElement>(null);
  const ocrRef = useRef<HTMLTextAreaElement>(null);
  const deleteBoxRef = useRef<(id: number) => void>(() => {});
  const hotkeyRef = useRef({
    idx: 0,
    imageCount: 0,
    canEdit: false,
    isReview: false,
    selectedBox: null as number | null,
  });

  const fileName = current
    ? current.filename || current.image_source.split("/").pop() || `image-${current.id}`
    : "";

  const imagePct = images.length ? Math.round(((idx + 1) / images.length) * 100) : 0;
  const onLastImage = images.length > 0 && idx >= images.length - 1;
  const submitLit = Boolean(showSubmit && onLastImage && submitEnabled !== false && canEdit);

  const selected = boxes.find((b) => b.id === selectedBox) || null;

  useEffect(() => {
    setSelectedBox(null);
    setActiveImageTag(null);
    setExpandedBoxTag(null);
    setFocusField(null);
    setHiddenBoxIds(new Set());
    setGoldenMarked(Boolean(current?.is_golden) || mode === "golden");
  }, [current?.id, mode]);

  const allBoxesHidden = boxes.length > 0 && boxes.every((b) => hiddenBoxIds.has(b.id));

  const toggleBoxVisible = (id: number) => {
    setHiddenBoxIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllBoxesVisible = () => {
    if (allBoxesHidden) {
      setHiddenBoxIds(new Set());
      return;
    }
    setHiddenBoxIds(new Set(boxes.map((b) => b.id)));
  };

  useEffect(() => {
    setClassMru([]);
    setDefaultDrawClass("");
  }, [taskId]);

  useEffect(() => {
    if (!taskClasses.length) {
      setDefaultDrawClass("");
      setClassMru([]);
      return;
    }
    setClassMru((prev) => {
      const lower = new Set(taskClasses.map((c) => c.toLowerCase()));
      const kept = prev.filter((c) => lower.has(c.toLowerCase()));
      const keptLower = new Set(kept.map((c) => c.toLowerCase()));
      const missing = taskClasses.filter((c) => !keptLower.has(c.toLowerCase()));
      return [...kept, ...missing];
    });
    setDefaultDrawClass((prev) => {
      if (prev && taskClasses.some((c) => c.toLowerCase() === prev.toLowerCase())) return prev;
      return "";
    });
  }, [taskClasses]);

  useEffect(() => {
    const el = imageListRef.current?.querySelector<HTMLElement>(`[data-img-idx="${idx}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [idx]);

  useEffect(() => {
    if (!focusField) return;
    const map: Record<Exclude<FocusField, null>, HTMLElement | null> = {
      imageCaption: imageCaptionRef.current,
      boxCaption: boxCaptionRef.current,
      ocr: ocrRef.current,
      class: null,
    };
    const el = map[focusField];
    el?.focus();
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusField, selectedBox]);

  useEffect(() => {
    setActiveBoxTagKey(null);
    setActiveImageTag(null);
    setExpandedBoxTag(null);
  }, [current?.id]);

  useEffect(() => {
    if (activeBoxTagKey == null) return;
    const boxId = Number(activeBoxTagKey.split(":")[0]);
    if (selectedBox !== boxId) setActiveBoxTagKey(null);
  }, [selectedBox, activeBoxTagKey]);

  hotkeyRef.current = {
    idx,
    imageCount: images.length,
    canEdit,
    isReview: Boolean(isReview),
    selectedBox,
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField =
        t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (inField) return;

      const k = e.key.toLowerCase();
      const h = hotkeyRef.current;
      if (k === "d") {
        e.preventDefault();
        onIdxChange(Math.max(0, h.idx - 1));
      } else if (k === "f") {
        e.preventDefault();
        onIdxChange(Math.min(h.imageCount - 1, h.idx + 1));
      } else if (k === "b" && h.canEdit && !h.isReview) {
        e.preventDefault();
        setTool("box");
      } else if (k === "s" && h.canEdit && !h.isReview) {
        e.preventDefault();
        setTool("segment");
      } else if (k === "h") {
        e.preventDefault();
        setTool("hand");
      } else if ((e.key === "Delete" || e.key === "Backspace") && h.canEdit && !h.isReview) {
        if (h.selectedBox == null) return;
        e.preventDefault();
        void deleteBoxRef.current(h.selectedBox);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onIdxChange]);

  const classIndex = useMemo(() => buildClassColorIndex(taskClasses), [taskClasses]);
  const colorOf = (cls: string) => classColorForName(cls || "?", classIndex);

  const patchBoxes = (updater: (boxes: Box[]) => Box[]) => {
    if (onBoxesChange) onBoxesChange(updater);
  };

  const reloadBoxesFallback = () => {
    if (!onBoxesChange) onReloadBoxes();
  };

  const boxTagEntries = useMemo(() => {
    const entries: { key: string; boxId: number; tag: string; box: Box }[] = [];
    boxes.forEach((b) => {
      b.tag.forEach((t) => entries.push({ key: `${b.id}:${t}`, boxId: b.id, tag: t, box: b }));
    });
    return entries;
  }, [boxes]);

  const drawClass = () => {
    if (defaultDrawClass) return defaultDrawClass;
    return classMru[0] || taskClasses[0] || "default";
  };

  const bumpClassMru = (className: string) => {
    const hit =
      taskClasses.find((c) => c.toLowerCase() === className.toLowerCase()) || className.trim();
    if (!hit) return;
    setDefaultDrawClass(hit);
    setClassMru((prev) => {
      const rest = prev.filter((c) => c.toLowerCase() !== hit.toLowerCase());
      return [hit, ...rest];
    });
  };

  const selectDefaultClass = (className: string) => {
    bumpClassMru(className);
  };

  const orderedTaskClasses = classMru.length ? classMru : taskClasses;

  const ensureClass = async (raw: string) => {
    const name = raw.trim();
    if (!name || !canEdit || isReview) return name;
    const exists = taskClasses.find((c) => c.toLowerCase() === name.toLowerCase());
    if (exists) {
      bumpClassMru(exists);
      return exists;
    }
    try {
      const r = await api<{ classes: string[] }>(
        `/api/tasks/${taskId}/classes?class_name=${encodeURIComponent(name)}`,
        { method: "POST" },
      );
      onTaskClassesChange(r.classes || [...taskClasses, name]);
      bumpClassMru(name);
      return name;
    } catch {
      return name;
    }
  };

  const addBox = async (points: string) => {
    if (!current || !canEdit || isReview) return;
    const cls = drawClass();
    bumpClassMru(cls);
    try {
      const created = await api<Box>(`/api/images/${current.id}/boxes`, {
        method: "POST",
        body: JSON.stringify({ class: cls || "default", box_points: points }),
      });
      patchBoxes((prev) => [...prev, created]);
      setSelectedBox(created.id);
      setTool("hand");
      if (!onBoxesChange) onReloadBoxes();
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : "Không thêm được box");
    }
  };

  const addSegment = async (points: string) => {
    if (!current || !canEdit || isReview) return;
    const cls = drawClass();
    const pts = points.trim().split(/\s+/).map(Number);
    let box_points = "0.5 0.5 0.1 0.1";
    if (pts.length >= 6) {
      const xs = pts.filter((_, i) => i % 2 === 0);
      const ys = pts.filter((_, i) => i % 2 === 1);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      box_points = `${(minX + maxX) / 2} ${(minY + maxY) / 2} ${Math.max(0.01, maxX - minX)} ${Math.max(0.01, maxY - minY)}`;
    }
    try {
      const created = await api<Box>(`/api/images/${current.id}/boxes`, {
        method: "POST",
        body: JSON.stringify({
          class: cls || "default",
          box_points,
          segment_points: points,
        }),
      });
      patchBoxes((prev) => [...prev, created]);
      setSelectedBox(created.id);
      setTool("hand");
      if (!onBoxesChange) onReloadBoxes();
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : "Không thêm được segment");
    }
  };

  const deleteBoxById = async (boxId: number) => {
    if (!canEdit || isReview) return;
    const targetId = Number(boxId);
    if (!Number.isFinite(targetId)) return;
    patchBoxes((prev) => prev.filter((b) => b.id !== targetId));
    setSelectedBox((cur) => (cur === targetId ? null : cur));
    setActiveBoxTagKey((cur) => (cur && cur.startsWith(`${targetId}:`) ? null : cur));
    setExpandedBoxTag((cur) => (cur && cur.startsWith(`${targetId}:`) ? null : cur));
    try {
      await api(`/api/images/boxes/${targetId}`, { method: "DELETE" });
    } catch (ex) {
      reloadBoxesFallback();
      alert(ex instanceof Error ? ex.message : "Không xóa được box");
    }
  };

  deleteBoxRef.current = (id) => {
    void deleteBoxById(id);
  };

  const updateSelected = async (patch: Partial<Box>) => {
    if (!selectedBox || !canEdit) return;
    const id = selectedBox;
    patchBoxes((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    try {
      const updated = await api<Box>(`/api/images/boxes/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      patchBoxes((prev) => prev.map((b) => (b.id === id ? updated : b)));
    } catch (ex) {
      reloadBoxesFallback();
      alert(ex instanceof Error ? ex.message : "Không cập nhật được box");
    }
  };

  const updateSelectedTagRemove = async (boxId: number, tag: string) => {
    if (!canEdit) return;
    const targetId = Number(boxId);
    if (!Number.isFinite(targetId)) return;
    // Thừa box: delete that box only (tag goes away with it). Never touch other boxes' tags.
    if (tag === "Thừa box") {
      await deleteBoxById(targetId);
      return;
    }
    let nextTags: string[] | undefined;
    patchBoxes((prev) => {
      const box = prev.find((b) => b.id === targetId);
      if (!box) return prev;
      nextTags = (box.tag || []).filter((t) => t !== tag);
      return prev.map((b) => (b.id === targetId ? { ...b, tag: nextTags! } : b));
    });
    if (!nextTags) return;
    const tagsToSave = nextTags;
    try {
      const updated = await api<Box>(`/api/images/boxes/${targetId}`, {
        method: "PATCH",
        body: JSON.stringify({ tag: tagsToSave }),
      });
      patchBoxes((prev) =>
        prev.map((b) =>
          b.id === targetId
            ? { ...b, ...updated, tag: Array.isArray(updated.tag) ? updated.tag : tagsToSave }
            : b,
        ),
      );
    } catch (ex) {
      reloadBoxesFallback();
      alert(ex instanceof Error ? ex.message : "Không xóa được tag");
    }
  };

  const updateBoxGeometry = async (
    id: number,
    patch: { box_points?: string; segment_points?: string },
  ) => {
    if (!canEdit || isReview) return;
    patchBoxes((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    try {
      const updated = await api<Box>(`/api/images/boxes/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      patchBoxes((prev) => prev.map((b) => (b.id === id ? updated : b)));
    } catch (ex) {
      reloadBoxesFallback();
      alert(ex instanceof Error ? ex.message : "Không cập nhật được box");
    }
  };

  const copyName = async () => {
    try {
      await navigator.clipboard.writeText(fileName);
      setCopiedFlash(true);
      setTimeout(() => setCopiedFlash(false), 1200);
    } catch {
      /* ignore */
    }
  };

  const toggleGolden = async () => {
    if (!current || mode === "golden" || !showGoldenToggle) return;
    try {
      if (goldenMarked) {
        const updated = await api<LaImage>(`/api/images/${current.id}/golden-pool`, {
          method: "DELETE",
        });
        setGoldenMarked(false);
        onImagesChange((imgs) => imgs.map((im) => (im.id === updated.id ? updated : im)));
      } else {
        const updated = await api<LaImage>(`/api/images/${current.id}/golden-pool`, {
          method: "POST",
        });
        setGoldenMarked(true);
        onImagesChange((imgs) => imgs.map((im) => (im.id === updated.id ? updated : im)));
      }
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : "Không cập nhật được golden pool");
    }
  };

  const focusFromImageTag = (tag: string) => {
    setActiveImageTag(tag);
    if (tag === "Thiếu box") {
      setFocusField(null);
      return;
    }
    if (tag === "Sai Caption") {
      setFocusField("imageCaption");
      return;
    }
    if (tag === "Thừa box" && boxes.length) {
      setSelectedBox(boxes[0].id);
    }
  };

  const focusFromBoxTag = (tag: string, boxId: number) => {
    setActiveBoxTagKey(`${boxId}:${tag}`);
    setSelectedBox(boxId);
    const t = tag.toLowerCase();
    if (t.includes("ocr")) setFocusField("ocr");
    else if (t.includes("caption")) setFocusField("boxCaption");
    else if (t.includes("class")) setFocusField("class");
    else if (t.includes("segment")) {
      setTool("segment");
      setFocusField(null);
    } else if (t.includes("box")) {
      setTool("box");
      setFocusField(null);
    } else setFocusField(null);
  };

  const toggleImageTag = async (tag: string) => {
    if (!current || !canEdit) return;
    const tags = current.tag.includes(tag) ? current.tag.filter((t) => t !== tag) : [...current.tag, tag];
    const updated = await api<LaImage>(`/api/images/${current.id}`, {
      method: "PATCH",
      body: JSON.stringify({ tag: tags }),
    });
    onImagesChange((imgs) => imgs.map((im) => (im.id === updated.id ? updated : im)));
  };

  const removeImageTag = async (tag: string) => {
    if (!current || !canEdit) return;
    if (tag === "Accept S1" || tag === "Accept All") return;
    try {
      const updated = await api<LaImage>(
        `/api/images/${current.id}/tags/${encodeURIComponent(tag)}`,
        { method: "DELETE" },
      );
      onImagesChange((imgs) => imgs.map((im) => (im.id === updated.id ? updated : im)));
      if (activeImageTag === tag) setActiveImageTag(null);
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : "Không xóa được tag ảnh");
    }
  };

  const commitClass = async (raw: string) => {
    const resolved = await ensureClass(raw);
    if (resolved) bumpClassMru(resolved);
    if (selectedBox && resolved) {
      await updateSelected({ class: resolved });
    }
  };

  const removeTaskClass = async (className: string) => {
    if (!canEdit) return;
    const ok = window.confirm(
      `Xóa class "${className}"?\nTất cả box có class này trên mọi ảnh của task cũng sẽ bị xóa.`,
    );
    if (!ok) return;
    try {
      const r = await api<{ classes?: string[] }>(
        `/api/tasks/${taskId}/classes/${encodeURIComponent(className)}`,
        { method: "DELETE" },
      );
      onTaskClassesChange(
        r.classes ?? taskClasses.filter((c) => c.toLowerCase() !== className.toLowerCase()),
      );
      if (selected?.class && selected.class.toLowerCase() === className.toLowerCase()) {
        setSelectedBox(null);
      }
      onReloadBoxes();
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : "Không xóa được class");
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
    <div className="annotate-root">
      <header className="anno-topbar">
        <div className="anno-topbar-left">
          <button type="button" className="topbar-btn anno-topbar-btn" onClick={onBack} title="Quay lại">
            ←
          </button>
          <button
            type="button"
            className="anno-filename"
            onClick={copyName}
            title={`${fileName} — click để copy`}
          >
            {fileName}
          </button>
          {copiedFlash && <span className="anno-copied">Copied</span>}
          {lockedByUsername ? (
            <span className={`lock-badge ${canEdit ? "mine" : "readonly"}`}>
              Lock by {lockedByUsername}
            </span>
          ) : (
            !canEdit && <span className="lock-badge readonly">Chỉ xem</span>
          )}
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
                onChange={(e) => onIdxChange(+e.target.value)}
                aria-label="Tiến trình ảnh"
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
            onClick={() => onIdxChange(Math.max(0, idx - 1))}
            disabled={idx === 0}
            title="Previous (D)"
          >
            Previous
          </button>
          <button
            type="button"
            className="topbar-btn anno-topbar-btn"
            onClick={() => onIdxChange(Math.min(images.length - 1, idx + 1))}
            disabled={idx >= images.length - 1}
            title="Next (F)"
          >
            Next
          </button>
          {showGoldenToggle && (
            <button
              type="button"
              className={`anno-golden-btn ${goldenMarked ? "on" : ""}`}
              onClick={toggleGolden}
              disabled={mode === "golden"}
              title={goldenMarked ? "Gỡ khỏi golden pool" : "Thêm vào golden pool"}
            >
              <IconDiamond size={14} />
            </button>
          )}
          {showSubmit && (
            <button
              type="button"
              className={`topbar-btn anno-topbar-btn ${submitLit ? "primary submit-ready" : ""}`}
              disabled={!submitLit}
              onClick={onSubmit}
              title={
                !canEdit
                  ? "Job đang bị lock"
                  : !onLastImage
                    ? "Chỉ submit ở ảnh cuối"
                    : "Submit job"
              }
            >
              Submit job
            </button>
          )}
          {showContinueS1 && (
            <button
              type="button"
              className={`topbar-btn anno-topbar-btn primary ${continueEnabled && canEdit ? "submit-ready" : ""}`}
              disabled={!continueEnabled || !canEdit}
              onClick={onContinueS1}
            >
              Continue S2
            </button>
          )}
        </div>
      </header>

      <div className="annotate-grid">
        <aside className="annotate-panel left">
          <div className="panel-section-title">Images</div>
          <div className="anno-image-list pretty-scroll" ref={imageListRef}>
            {images.map((im, i) => (
              <button
                key={im.id}
                type="button"
                data-img-idx={i}
                className={`anno-image-row ${i === idx ? "active" : ""}`}
                onClick={() => onIdxChange(i)}
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
                <span className="anno-image-row-name">
                  {im.filename || im.image_source.split("/").pop()}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <div className="canvas-panel">
          <div className="canvas-stage-wrap">
            <AnnotationCanvas
              imageUrl={imageUrl(current.id)}
              boxes={boxes}
              selectedId={selectedBox}
              tool={tool}
              readOnly={!canEdit || Boolean(isReview)}
              classOrder={taskClasses}
              defaultClass={drawClass()}
              hiddenBoxIds={hiddenBoxIds}
              onSelect={setSelectedBox}
              onCreateBox={addBox}
              onCreateSegment={addSegment}
              onUpdateBox={updateBoxGeometry}
              onAfterCreate={() => setTool("hand")}
            />
            <div className="anno-float-tools">
              <button
                type="button"
                className={`anno-float-btn ${tool === "box" ? "active" : ""}`}
                onClick={() => setTool("box")}
                disabled={!canEdit || Boolean(isReview)}
                title="Box (B)"
              >
                <IconBox size={14} />
              </button>
              <button
                type="button"
                className={`anno-float-btn ${tool === "segment" ? "active" : ""}`}
                onClick={() => setTool("segment")}
                disabled={!canEdit || Boolean(isReview)}
                title="Segment (S) — Enter để đóng (≥3 điểm)"
              >
                <IconSegment size={14} />
              </button>
              <button
                type="button"
                className={`anno-float-btn ${tool === "hand" ? "active" : ""}`}
                onClick={() => setTool("hand")}
                title="Hand (H) — kéo/chỉnh box & segment; Ctrl+kéo để pan ảnh"
              >
                <IconHand size={14} />
              </button>
            </div>
          </div>

          <footer className="anno-fields">
            <div className={`anno-field anno-field-oneline ${focusField === "imageCaption" ? "focused" : ""}`}>
              <label>Image caption</label>
              <textarea
                ref={imageCaptionRef}
                rows={1}
                className="anno-oneline-input pretty-scroll"
                lang="vi"
                value={current.caption || ""}
                placeholder={
                  !canEdit || isReview ? "Không thể chỉnh sửa" : "Nhập image caption..."
                }
                disabled={!canEdit || Boolean(isReview)}
                onChange={async (e) => {
                  const updated = await api<LaImage>(`/api/images/${current.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ caption: e.target.value }),
                  });
                  onImagesChange((imgs) => imgs.map((im) => (im.id === updated.id ? updated : im)));
                }}
              />
            </div>
            <div className={`anno-field anno-field-oneline ${focusField === "boxCaption" ? "focused" : ""}`}>
              <label>Box caption</label>
              <textarea
                ref={boxCaptionRef}
                rows={1}
                className="anno-oneline-input pretty-scroll"
                lang="vi"
                value={selected?.caption || ""}
                placeholder={
                  !selected
                    ? "Chọn box"
                    : !canEdit || isReview
                      ? "Không thể chỉnh sửa"
                      : "Nhập box caption..."
                }
                disabled={!selected || !canEdit || Boolean(isReview)}
                onChange={(e) => updateSelected({ caption: e.target.value })}
              />
            </div>
            <div className={`anno-field anno-field-oneline ${focusField === "ocr" ? "focused" : ""}`}>
              <label>OCR text</label>
              <textarea
                ref={ocrRef}
                rows={1}
                className="anno-oneline-input pretty-scroll"
                lang="vi"
                value={selected?.ocr_text || ""}
                placeholder={
                  !selected
                    ? "Chọn box"
                    : !canEdit || isReview
                      ? "Không thể chỉnh sửa"
                      : "Nhập OCR..."
                }
                disabled={!selected || !canEdit || Boolean(isReview)}
                onChange={(e) => updateSelected({ ocr_text: e.target.value })}
              />
            </div>
            <div className={`anno-field anno-field-class ${focusField === "class" ? "focused" : ""}`}>
              <label>Class</label>
              {selected ? (
                <ClassCombobox
                  classes={taskClasses}
                  value={selected.class || ""}
                  disabled={!canEdit || Boolean(isReview)}
                  placeholder="Class..."
                  classIndex={classIndex}
                  onChange={(c) => void updateSelected({ class: c })}
                  onCommitNew={(c) => commitClass(c)}
                />
              ) : (
                <input className="anno-oneline-input" disabled placeholder="Chọn box" />
              )}
            </div>
          </footer>
        </div>

        <aside className="annotate-panel right">
          <div className="anno-panel-card anno-fixed-boxes">
            <div className="panel-section-title anno-section-title-row">
              <span>Boxes ({boxes.length})</span>
              <button
                type="button"
                className={`anno-vis-btn ${allBoxesHidden ? "off" : ""}`}
                title={allBoxesHidden ? "Hiện tất cả box" : "Ẩn tất cả box"}
                disabled={boxes.length === 0}
                onClick={toggleAllBoxesVisible}
              >
                {allBoxesHidden ? <IconEyeOff size={13} /> : <IconEye size={13} />}
              </button>
            </div>
            <div className="anno-box-list pretty-scroll">
              {boxes.length === 0 && <span className="anno-muted">—</span>}
              {boxes.map((b) => {
                const hidden = hiddenBoxIds.has(b.id);
                return (
                  <div
                    key={b.id}
                    className={`anno-box-row ${selectedBox === b.id ? "selected" : ""} ${hidden ? "hidden-box" : ""}`}
                  >
                    <button
                      type="button"
                      className="anno-box-row-main"
                      onClick={() => setSelectedBox(b.id)}
                    >
                      <span className="anno-box-swatch" style={{ background: colorOf(b.class) }} />
                      <span className="anno-box-row-name">{b.class || "(no class)"}</span>
                    </button>
                    <button
                      type="button"
                      className={`anno-vis-btn ${hidden ? "off" : ""}`}
                      title={hidden ? "Hiện box" : "Ẩn box"}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleBoxVisible(b.id);
                      }}
                    >
                      {hidden ? <IconEyeOff size={12} /> : <IconEye size={12} />}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="anno-panel-card anno-fixed-classes">
            <div className="panel-section-title">Task classes</div>
            <div className="anno-chip-row anno-chip-row-scroll anno-task-class-list pretty-scroll">
              {taskClasses.length === 0 && <span className="anno-muted">—</span>}
              {orderedTaskClasses.map((c) => {
                const border = colorOf(c);
                const active = defaultDrawClass.toLowerCase() === c.toLowerCase();
                return (
                  <span
                    key={c}
                    className={`anno-chip with-x task-class-chip ${active ? "active" : ""}`}
                    style={
                      active
                        ? {
                            borderColor: border,
                            background: border,
                            color: classContrastText(border),
                          }
                        : {
                            borderColor: border,
                            background: "transparent",
                            color: border,
                          }
                    }
                  >
                    <button
                      type="button"
                      className="anno-chip-label"
                      onClick={() => selectDefaultClass(c)}
                    >
                      {c}
                    </button>
                    {canEdit && (
                      <button
                        type="button"
                        className="anno-chip-x"
                        style={{ color: "inherit" }}
                        title={`Xóa class ${c}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void removeTaskClass(c);
                        }}
                      >
                        ×
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
          </div>

          <div className="anno-side-divider" aria-hidden>
            <span />
          </div>

          <div className="anno-panel-card anno-fixed-image-tags">
            <div className="panel-section-title">Image tags</div>
            <div className="anno-chip-row anno-chip-row-scroll pretty-scroll">
              {current.tag.map((t) => {
                const canClear =
                  canEdit && !isReview && t !== "Accept S1" && t !== "Accept All";
                return (
                  <span
                    key={t}
                    className={`anno-chip with-x ${activeImageTag === t ? "active" : ""}`}
                  >
                    <button
                      type="button"
                      className="anno-chip-label"
                      onClick={() => focusFromImageTag(t)}
                    >
                      {t}
                    </button>
                    {t !== "Accept S1" && t !== "Accept All" && (
                      <button
                        type="button"
                        className="anno-chip-x"
                        title="Đánh dấu đã sửa (xóa tag)"
                        disabled={!canClear}
                        onClick={(e) => {
                          e.stopPropagation();
                          void removeImageTag(t);
                        }}
                      >
                        ×
                      </button>
                    )}
                  </span>
                );
              })}
              {current.tag.length === 0 && <span className="anno-muted">—</span>}
            </div>
            {isReview && canEdit && (
              <div className="anno-chip-row" style={{ marginTop: 6 }}>
                {IMAGE_ERROR_TAGS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`anno-chip ${current.tag.includes(t) ? "active" : ""}`}
                    onClick={() => toggleImageTag(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="anno-panel-card anno-fixed-box-tags">
            <div className="panel-section-title">Box tags</div>
            <div className="anno-box-tag-list pretty-scroll">
              {boxTagEntries.length === 0 && <span className="anno-muted">—</span>}
              {boxTagEntries.map((e) => {
                const open = expandedBoxTag === e.key;
                const active = activeBoxTagKey === e.key;
                return (
                  <div
                    key={e.key}
                    className={`anno-box-tag-item ${open ? "open" : ""} ${active ? "active" : ""}`}
                  >
                    <div className="anno-box-tag-head">
                      <button
                        type="button"
                        className="anno-box-tag-name"
                        onClick={() => focusFromBoxTag(e.tag, e.boxId)}
                      >
                        {e.tag}
                      </button>
                      <button
                        type="button"
                        className="anno-box-tag-chevron"
                        onClick={() => setExpandedBoxTag(open ? null : e.key)}
                        aria-label={open ? "Thu gọn" : "Chi tiết"}
                      >
                        {open ? "▴" : "▾"}
                      </button>
                      {canEdit && !isReview && (
                        <button
                          type="button"
                          className="btn-x"
                          title={
                            e.tag === "Thừa box"
                              ? "Xóa box thừa (theo tag)"
                              : "Đánh dấu đã sửa (xóa tag)"
                          }
                          onClick={(ev) => {
                            ev.stopPropagation();
                            const boxId = e.boxId;
                            const tag = e.tag;
                            void updateSelectedTagRemove(boxId, tag);
                          }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                    {open && (
                      <div className="anno-box-tag-detail">
                        {parseTagDetails(e.box.details)[e.tag]?.trim() || "—"}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
