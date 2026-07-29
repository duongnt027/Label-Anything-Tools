import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { api, Box, imageUrl, LaImage } from "../api";
import AnnotationCanvas, { AnnotateTool, AnnotationCanvasHandle } from "./AnnotationCanvas";
import { ClassCombobox } from "./ClassCombobox";
import { ColoredOutlineChip } from "./ColoredOutlineChip";
import { IconBox, IconDiamond, IconEye, IconEyeOff, IconHand, IconSegment } from "./icons";
import { boxCreatePayload, boxGeometry, cloneBox, makeOptimisticBox } from "../utils/boxPayload";
import { buildClassColorIndex, classColorForName } from "../utils/classColors";
import { parseTagDetails } from "../utils/tagDetails";
import { getBoxTrackId, withBoxTrackMeta } from "../utils/boxTrack";

const IMAGE_ERROR_TAGS = ["Thiếu box", "Thừa box", "Sai Caption"];

const HOTKEY_SINGLE_KEYS = new Set(["d", "f", "b", "s", "h", "x", "n"]);

type HistoryRecord = { undo: () => Promise<void>; redo: () => Promise<void> };

type FocusField = "imageCaption" | "boxCaption" | "ocr" | "class" | null;

type Props = {
  mode: "job" | "golden";
  images: LaImage[];
  idx: number;
  onIdxChange: (i: number) => void;
  /** Warm cache for a target index before navigation finishes (optional). */
  onPrefetchIndex?: (i: number) => void;
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
  jobId?: string | number;
  onTrackBoxesInvalidate?: (imageIds: number[]) => void;
  onTrackBoxCreated?: (imageId: number, box: Box) => void;
  onTrackDeleted?: (trackId: string, tailImageIds: number[]) => void;
};

export default function AnnotationScreen({
  mode,
  images,
  idx,
  onIdxChange,
  onPrefetchIndex,
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
  jobId,
  onTrackBoxesInvalidate,
  onTrackBoxCreated,
  onTrackDeleted,
}: Props) {
  const current = images[idx];
  const [selectedBox, setSelectedBox] = useState<number | null>(null);
  const [tool, setTool] = useState<AnnotateTool>("hand");
  const [defaultDrawClass, setDefaultDrawClass] = useState<string>("");
  /** Most-recently-used class order (newest first). */
  const [classMru, setClassMru] = useState<string[]>([]);
  const [activeImageTag, setActiveImageTag] = useState<string | null>(null);
  const [activeBoxTagKey, setActiveBoxTagKey] = useState<string | null>(null);
  const [expandedBoxTag, setExpandedBoxTag] = useState<string | null>(null);
  const [goldenMarked, setGoldenMarked] = useState(false);
  const [copiedFlash, setCopiedFlash] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [imageCaptionDraft, setImageCaptionDraft] = useState("");
  const [boxCaptionDraft, setBoxCaptionDraft] = useState("");
  const [ocrDraft, setOcrDraft] = useState("");
  const [classDraft, setClassDraft] = useState("");
  const [focusField, setFocusField] = useState<FocusField>(null);
  const [hiddenBoxIds, setHiddenBoxIds] = useState<Set<number>>(() => new Set());
  const [boxTrackMode, setBoxTrackMode] = useState(false);
  const [segmentTrackMode, setSegmentTrackMode] = useState(false);
  const [taskClassFilter, setTaskClassFilter] = useState("");
  const [boxContextMenu, setBoxContextMenu] = useState<{ x: number; y: number } | null>(null);
  const boxContextMenuRef = useRef<{ x: number; y: number } | null>(null);
  boxContextMenuRef.current = boxContextMenu;

  const imageListRef = useRef<HTMLDivElement>(null);
  const boxListRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<AnnotationCanvasHandle>(null);
  const imageCaptionRef = useRef<HTMLTextAreaElement>(null);
  const boxCaptionRef = useRef<HTMLTextAreaElement>(null);
  const ocrRef = useRef<HTMLTextAreaElement>(null);
  const deleteBoxRef = useRef<(id: number) => void>(() => {});
  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});
  const imageIdRef = useRef(0);
  const historyApplyingRef = useRef(false);
  const trackOpGenRef = useRef(0);
  const undoStackRef = useRef<HistoryRecord[]>([]);
  const redoStackRef = useRef<HistoryRecord[]>([]);
  const flushSaveRef = useRef<() => Promise<boolean>>(async () => true);
  const goToIndexRef = useRef<(next: number) => void>(() => {});
  const prefetchIndexRef = useRef<(i: number) => void | undefined>(undefined);
  prefetchIndexRef.current = onPrefetchIndex;
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
    setImageCaptionDraft(current?.caption || "");
  }, [current?.id, current?.caption]);

  useEffect(() => {
    setBoxCaptionDraft(selected?.caption || "");
    setOcrDraft(selected?.ocr_text || "");
    setClassDraft(selected?.class || "");
  }, [selectedBox, selected?.id, selected?.caption, selected?.ocr_text, selected?.class]);

  useEffect(() => {
    setSelectedBox(null);
    setActiveImageTag(null);
    setExpandedBoxTag(null);
    setFocusField(null);
    setHiddenBoxIds(new Set());
    setGoldenMarked(Boolean(current?.is_golden) || mode === "golden");
    undoStackRef.current = [];
    redoStackRef.current = [];
  }, [current?.id, mode]);

  imageIdRef.current = current?.id ?? 0;

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
    if (selectedBox == null) return;
    const el = boxListRef.current?.querySelector<HTMLElement>(`[data-box-id="${selectedBox}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedBox, boxes]);

  useEffect(() => {
    if (!boxContextMenu) return;
    const close = () => setBoxContextMenu(null);
    const onPointer = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest(".anno-context-menu")) return;
      close();
    };
    window.addEventListener("mousedown", onPointer, true);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("mousedown", onPointer, true);
      window.removeEventListener("scroll", close, true);
    };
  }, [boxContextMenu]);

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
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const h = hotkeyRef.current;

      if (mod && k === "s") {
        e.preventDefault();
        void flushSaveRef.current().then((ok) => {
          if (ok) {
            setSavedFlash(true);
            setTimeout(() => setSavedFlash(false), 1200);
          }
        });
        return;
      }

      if (boxContextMenuRef.current && (k === "o" || k === "c")) {
        e.preventDefault();
        setFocusField(k === "o" ? "ocr" : "boxCaption");
        setBoxContextMenu(null);
        return;
      }

      if (e.key === "Escape") {
        setBoxContextMenu(null);
        return;
      }

      if (inField) return;

      if (mod && k === "z" && !e.shiftKey) {
        e.preventDefault();
        if (canvasRef.current?.undoSegmentDraftPoint()) return;
        undoRef.current();
        return;
      }
      if (mod && ((k === "z" && e.shiftKey) || k === "y")) {
        e.preventDefault();
        redoRef.current();
        return;
      }

      if (e.key === "ArrowLeft" || k === "d") {
        e.preventDefault();
        const next = Math.max(0, h.idx - 1);
        prefetchIndexRef.current?.(next);
        goToIndexRef.current(next);
      } else if (e.key === "ArrowRight" || k === "f") {
        e.preventDefault();
        const next = Math.min(h.imageCount - 1, h.idx + 1);
        prefetchIndexRef.current?.(next);
        goToIndexRef.current(next);
      } else if (e.altKey && k === "b" && h.canEdit && !h.isReview) {
        e.preventDefault();
        setTool("box");
        setBoxTrackMode((v) => !v);
      } else if (e.altKey && k === "s" && h.canEdit && !h.isReview) {
        e.preventDefault();
        setTool("segment");
        setSegmentTrackMode((v) => !v);
      } else if (k === "b" && h.canEdit && !h.isReview) {
        e.preventDefault();
        setTool("box");
      } else if (k === "s" && h.canEdit && !h.isReview) {
        e.preventDefault();
        setTool("segment");
      } else if (k === "h") {
        e.preventDefault();
        setTool("hand");
      } else if (
        (k === "x" || e.key === "Delete" || e.key === "Backspace") &&
        h.canEdit &&
        !h.isReview
      ) {
        if (h.selectedBox == null) return;
        e.preventDefault();
        void deleteBoxRef.current(h.selectedBox);
      } else if (h.selectedBox == null) {
        if (k === "n") {
          e.preventDefault();
          setFocusField("imageCaption");
        } else if (
          e.key.length === 1 &&
          !mod &&
          !e.altKey &&
          !HOTKEY_SINGLE_KEYS.has(k)
        ) {
          e.preventDefault();
          setFocusField("imageCaption");
          setImageCaptionDraft((prev) => prev + e.key);
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const classIndex = useMemo(() => buildClassColorIndex(taskClasses), [taskClasses]);
  const colorOf = (cls: string) => classColorForName(cls || "?", classIndex);

  const patchBoxes = (updater: (boxes: Box[]) => Box[]) => {
    if (onBoxesChange) onBoxesChange(updater);
  };

  const reloadBoxesFallback = () => {
    if (!onBoxesChange) onReloadBoxes();
  };

  const pushHistory = (record: HistoryRecord) => {
    if (historyApplyingRef.current || !canEdit || isReview) return;
    undoStackRef.current.push(record);
    redoStackRef.current = [];
  };

  const runHistory = async (which: "undo" | "redo") => {
    if (!canEdit || isReview) return;
    const stack = which === "undo" ? undoStackRef.current : redoStackRef.current;
    const other = which === "undo" ? redoStackRef.current : undoStackRef.current;
    const record = stack.pop();
    if (!record) return;
    historyApplyingRef.current = true;
    try {
      if (which === "undo") await record.undo();
      else await record.redo();
      other.push(record);
    } catch (ex) {
      stack.push(record);
      alert(ex instanceof Error ? ex.message : which === "undo" ? "Không undo được" : "Không redo được");
      reloadBoxesFallback();
    } finally {
      historyApplyingRef.current = false;
    }
  };

  undoRef.current = () => {
    void runHistory("undo");
  };
  redoRef.current = () => {
    void runHistory("redo");
  };

  const recordCreateHistory = (created: Box) => {
    const idRef = { id: created.id };
    const payload = boxCreatePayload(created);
    pushHistory({
      undo: async () => {
        await api(`/api/images/boxes/${idRef.id}`, { method: "DELETE" });
        patchBoxes((prev) => prev.filter((b) => b.id !== idRef.id));
        setSelectedBox((cur) => (cur === idRef.id ? null : cur));
      },
      redo: async () => {
        const imgId = imageIdRef.current;
        if (!imgId) return;
        const c = await api<Box>(`/api/images/${imgId}/boxes`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        idRef.id = c.id;
        patchBoxes((prev) => [...prev, c]);
        setSelectedBox(c.id);
      },
    });
  };

  const recordDeleteHistory = (snapshot: Box) => {
    const snap = cloneBox(snapshot);
    const idRef = { id: snap.id };
    const payload = boxCreatePayload(snap);
    pushHistory({
      undo: async () => {
        const imgId = imageIdRef.current;
        if (!imgId) return;
        const c = await api<Box>(`/api/images/${imgId}/boxes`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        idRef.id = c.id;
        patchBoxes((prev) => [...prev, c]);
        setSelectedBox(c.id);
      },
      redo: async () => {
        await api(`/api/images/boxes/${idRef.id}`, { method: "DELETE" });
        patchBoxes((prev) => prev.filter((b) => b.id !== idRef.id));
        setSelectedBox((cur) => (cur === idRef.id ? null : cur));
        setActiveBoxTagKey((cur) => (cur && cur.startsWith(`${idRef.id}:`) ? null : cur));
        setExpandedBoxTag((cur) => (cur && cur.startsWith(`${idRef.id}:`) ? null : cur));
      },
    });
  };

  const recordGeometryHistory = (
    boxId: number,
    before: ReturnType<typeof boxGeometry>,
    after: ReturnType<typeof boxGeometry>,
  ) => {
    pushHistory({
      undo: async () => {
        await api<Box>(`/api/images/boxes/${boxId}`, {
          method: "PATCH",
          body: JSON.stringify(before),
        });
        patchBoxes((prev) =>
          prev.map((b) => (b.id === boxId ? { ...b, ...before } : b)),
        );
      },
      redo: async () => {
        await api<Box>(`/api/images/boxes/${boxId}`, {
          method: "PATCH",
          body: JSON.stringify(after),
        });
        patchBoxes((prev) =>
          prev.map((b) => (b.id === boxId ? { ...b, ...after } : b)),
        );
      },
    });
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

  const orderedTaskClasses = classMru.length ? classMru : taskClasses;

  const filteredTaskClasses = useMemo(() => {
    const q = taskClassFilter.trim().toLowerCase();
    if (!q) return orderedTaskClasses;
    return orderedTaskClasses.filter((c) => c.toLowerCase().includes(q));
  }, [orderedTaskClasses, taskClassFilter]);

  const blurAnnotationFields = useCallback(() => {
    const ae = document.activeElement;
    if (ae instanceof HTMLElement) ae.blur();
    setFocusField(null);
  }, []);

  useEffect(() => {
    const isFieldTarget = (el: HTMLElement | null) => {
      if (!el) return false;
      if (el.closest(".class-combo-menu") || el.closest(".class-picker-menu")) return true;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable) return true;
      return false;
    };
    const onPointer = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (isFieldTarget(t)) return;
      blurAnnotationFields();
    };
    window.addEventListener("mousedown", onPointer, true);
    return () => window.removeEventListener("mousedown", onPointer, true);
  }, [blurAnnotationFields]);

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

  const listBoxesForImage = useCallback(
    (imageId: number) =>
      mode === "job" && jobId != null
        ? api<Box[]>(`/api/jobs/${jobId}/images/${imageId}/boxes`)
        : api<Box[]>(`/api/images/${imageId}/boxes`),
    [mode, jobId],
  );

  const deleteBoxQuiet = async (boxId: number) => {
    try {
      await api(`/api/images/boxes/${boxId}`, { method: "DELETE" });
    } catch (ex) {
      const msg = ex instanceof Error ? ex.message : String(ex);
      if (/not found|404/i.test(msg)) return;
      throw ex;
    }
  };

  const propagateTrackBoxes = async (startFrameIdx: number, body: Record<string, string>) => {
    const tail = images.slice(startFrameIdx + 1);
    if (!tail.length) return;
    const gen = trackOpGenRef.current;
    onTrackBoxesInvalidate?.(tail.map((im) => im.id));
    const CONC = 8;
    for (let i = 0; i < tail.length; i += CONC) {
      if (gen !== trackOpGenRef.current) return;
      const chunk = tail.slice(i, i + CONC);
      await Promise.all(
        chunk.map(async (im) => {
          if (gen !== trackOpGenRef.current) return;
          try {
            const created = await api<Box>(`/api/images/${im.id}/boxes`, {
              method: "POST",
              body: JSON.stringify(body),
            });
            if (gen !== trackOpGenRef.current) return;
            onTrackBoxCreated?.(im.id, created);
          } catch {
            /* per-frame */
          }
        }),
      );
    }
  };

  const deleteTrackOnFollowingFrames = async (trackId: string, fromFrameIdx: number) => {
    const tailIds: number[] = [];
    for (let i = fromFrameIdx + 1; i < images.length; i++) {
      const im = images[i];
      if (!im) continue;
      tailIds.push(im.id);
      try {
        const list = await listBoxesForImage(im.id);
        for (const b of list) {
          if (getBoxTrackId(b.details) === trackId) {
            await deleteBoxQuiet(b.id);
          }
        }
      } catch {
        /* per-frame */
      }
    }
    if (tailIds.length) {
      onTrackBoxesInvalidate?.(tailIds);
      onTrackDeleted?.(trackId, tailIds);
    }
  };

  const addBox = async (points: string) => {
    if (!current || !canEdit || isReview) return;
    const cls = drawClass();
    bumpClassMru(cls);
    const startFrameIdx = idx;
    const trackId = boxTrackMode ? crypto.randomUUID() : null;
    const payload: Record<string, string> = {
      class: cls || "default",
      box_points: points,
    };
    if (trackId) payload.details = withBoxTrackMeta(undefined, trackId, startFrameIdx);
    const optimistic = makeOptimisticBox(current.id, {
      class: cls || "default",
      box_points: points,
      details: payload.details,
    });
    const tempId = optimistic.id;
    flushSync(() => {
      patchBoxes((prev) => [...prev, optimistic]);
      setSelectedBox(tempId);
      setTool("hand");
    });
    try {
      const created = await api<Box>(`/api/images/${current.id}/boxes`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      patchBoxes((prev) => prev.map((b) => (b.id === tempId ? created : b)));
      setSelectedBox(created.id);
      if (trackId) {
        setBoxTrackMode(false);
        void propagateTrackBoxes(startFrameIdx, payload);
      } else if (!historyApplyingRef.current) recordCreateHistory(created);
      if (!trackId && !onBoxesChange) onReloadBoxes();
    } catch (ex) {
      patchBoxes((prev) => prev.filter((b) => b.id !== tempId));
      setSelectedBox((cur) => (cur === tempId ? null : cur));
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
    const startFrameIdx = idx;
    const trackId = segmentTrackMode ? crypto.randomUUID() : null;
    const payload: Record<string, string> = {
      class: cls || "default",
      box_points,
      segment_points: points,
    };
    if (trackId) payload.details = withBoxTrackMeta(undefined, trackId, startFrameIdx);
    const optimistic = makeOptimisticBox(current.id, {
      class: cls || "default",
      box_points,
      segment_points: points,
      details: payload.details,
    });
    const tempId = optimistic.id;
    flushSync(() => {
      patchBoxes((prev) => [...prev, optimistic]);
      setSelectedBox(tempId);
      setTool("hand");
    });
    try {
      const created = await api<Box>(`/api/images/${current.id}/boxes`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      patchBoxes((prev) => prev.map((b) => (b.id === tempId ? created : b)));
      setSelectedBox(created.id);
      if (trackId) {
        setSegmentTrackMode(false);
        void propagateTrackBoxes(startFrameIdx, payload);
      } else if (!historyApplyingRef.current) recordCreateHistory(created);
      if (!trackId && !onBoxesChange) onReloadBoxes();
    } catch (ex) {
      patchBoxes((prev) => prev.filter((b) => b.id !== tempId));
      setSelectedBox((cur) => (cur === tempId ? null : cur));
      alert(ex instanceof Error ? ex.message : "Không thêm được segment");
    }
  };

  const deleteBoxById = async (boxId: number) => {
    if (!canEdit || isReview) return;
    const targetId = Number(boxId);
    if (!Number.isFinite(targetId)) return;
    const snapshot = boxes.find((b) => b.id === targetId);
    if (!snapshot) return;
    const frameIdx = idx;
    const trackId = getBoxTrackId(snapshot.details);
    if (!historyApplyingRef.current && !trackId) recordDeleteHistory(snapshot);
    patchBoxes((prev) => prev.filter((b) => b.id !== targetId));
    setSelectedBox((cur) => (cur === targetId ? null : cur));
    setActiveBoxTagKey((cur) => (cur && cur.startsWith(`${targetId}:`) ? null : cur));
    setExpandedBoxTag((cur) => (cur && cur.startsWith(`${targetId}:`) ? null : cur));
    try {
      if (trackId && mode === "job" && jobId != null) {
        trackOpGenRef.current += 1;
        const fromOrder = images[frameIdx]?.order_index ?? frameIdx;
        const cacheBustIds = images.slice(frameIdx).map((im) => im.id);
        await api(`/api/jobs/${jobId}/delete-track-boxes`, {
          method: "POST",
          body: JSON.stringify({ track_id: trackId, from_order_index: fromOrder }),
        });
        onTrackBoxesInvalidate?.(cacheBustIds);
        onTrackDeleted?.(trackId, cacheBustIds.slice(1));
      } else {
        await deleteBoxQuiet(targetId);
        if (trackId) {
          trackOpGenRef.current += 1;
          await deleteTrackOnFollowingFrames(trackId, frameIdx);
        }
      }
    } catch (ex) {
      reloadBoxesFallback();
      alert(ex instanceof Error ? ex.message : "Không xóa được box");
    }
  };

  deleteBoxRef.current = (id) => {
    void deleteBoxById(id);
  };

  const flushBoxFields = useCallback(
    async (boxId: number, drafts: { caption: string; ocr: string; className: string }) => {
      const box = boxes.find((b) => b.id === boxId);
      if (!box || !canEdit || isReview) return true;
      const patch: Partial<Box> = {};
      if ((box.caption || "") !== drafts.caption) patch.caption = drafts.caption;
      if ((box.ocr_text || "") !== drafts.ocr) patch.ocr_text = drafts.ocr;
      if ((box.class || "") !== drafts.className) patch.class = drafts.className;
      if (!Object.keys(patch).length) return true;
      try {
        const updated = await api<Box>(`/api/images/boxes/${boxId}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        });
        patchBoxes((prev) => prev.map((b) => (b.id === boxId ? updated : b)));
        return true;
      } catch (ex) {
        reloadBoxesFallback();
        alert(ex instanceof Error ? ex.message : "Không lưu được box");
        return false;
      }
    },
    [boxes, canEdit, isReview],
  );

  const selectTaskClass = useCallback(
    (className: string) => {
      setTaskClassFilter("");
      bumpClassMru(className);
      if (selectedBox != null && canEdit && !isReview) {
        setClassDraft(className);
        void flushBoxFields(selectedBox, {
          caption: boxCaptionDraft,
          ocr: ocrDraft,
          className,
        });
      }
    },
    [
      boxCaptionDraft,
      canEdit,
      flushBoxFields,
      isReview,
      ocrDraft,
      selectedBox,
    ],
  );

  const flushSave = useCallback(async (): Promise<boolean> => {
    if (!current || !canEdit || isReview) return true;
    try {
      if ((current.caption || "") !== imageCaptionDraft) {
        const updated = await api<LaImage>(`/api/images/${current.id}`, {
          method: "PATCH",
          body: JSON.stringify({ caption: imageCaptionDraft }),
        });
        onImagesChange((imgs) => imgs.map((im) => (im.id === updated.id ? updated : im)));
      }
      if (selectedBox != null) {
        const ok = await flushBoxFields(selectedBox, {
          caption: boxCaptionDraft,
          ocr: ocrDraft,
          className: classDraft,
        });
        if (!ok) return false;
      }
      return true;
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : "Không lưu được");
      return false;
    }
  }, [
    boxCaptionDraft,
    canEdit,
    classDraft,
    current,
    flushBoxFields,
    imageCaptionDraft,
    isReview,
    ocrDraft,
    onImagesChange,
    selectedBox,
  ]);

  flushSaveRef.current = flushSave;

  const goToIndex = useCallback(
    async (next: number) => {
      if (next < 0 || next >= images.length || next === idx) return;
      const ok = await flushSave();
      if (!ok) return;
      onIdxChange(next);
    },
    [flushSave, idx, images.length, onIdxChange],
  );

  goToIndexRef.current = (next: number) => {
    void goToIndex(next);
  };

  const selectBox = (id: number | null) => {
    if (id === selectedBox) return;
    void (async () => {
      if (canEdit && !isReview && selectedBox != null) {
        const ok = await flushBoxFields(selectedBox, {
          caption: boxCaptionDraft,
          ocr: ocrDraft,
          className: classDraft,
        });
        if (!ok) return;
      }
      setSelectedBox(id);
    })();
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
    const prev = boxes.find((b) => b.id === id);
    if (!prev) return;
    const before = boxGeometry(prev);
    const after = {
      box_points: patch.box_points ?? prev.box_points,
      segment_points: patch.segment_points ?? prev.segment_points ?? "",
    };
    if (before.box_points === after.box_points && before.segment_points === after.segment_points) {
      return;
    }
    patchBoxes((p) => p.map((b) => (b.id === id ? { ...b, ...after } : b)));
    try {
      const updated = await api<Box>(`/api/images/boxes/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      patchBoxes((p) => p.map((b) => (b.id === id ? updated : b)));
      if (!historyApplyingRef.current) recordGeometryHistory(id, before, after);
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
    if (resolved) {
      bumpClassMru(resolved);
      setClassDraft(resolved);
      if (selectedBox) {
        await flushBoxFields(selectedBox, {
          caption: boxCaptionDraft,
          ocr: ocrDraft,
          className: resolved,
        });
      }
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
          <button
            type="button"
            className="topbar-btn anno-topbar-btn"
            onClick={() => {
              void flushSave().then((ok) => {
                if (ok) onBack();
              });
            }}
            title="Quay lại"
          >
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
          {savedFlash && <span className="anno-copied">Saved</span>}
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
                onChange={(e) => goToIndexRef.current(+e.target.value)}
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
            onClick={() => goToIndexRef.current(Math.max(0, idx - 1))}
            disabled={idx === 0}
            title="Previous (D)"
          >
            Previous
          </button>
          <button
            type="button"
            className="topbar-btn anno-topbar-btn"
            onClick={() => goToIndexRef.current(Math.min(images.length - 1, idx + 1))}
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
                onClick={() => goToIndexRef.current(i)}
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

        <div
          className="canvas-panel"
          onContextMenu={(e) => {
            if (!selectedBox) return;
            e.preventDefault();
            setBoxContextMenu({ x: e.clientX, y: e.clientY });
          }}
        >
          <div className="canvas-stage-wrap">
            <AnnotationCanvas
              ref={canvasRef}
              imageUrl={imageUrl(current.id)}
              imageId={current.id}
              boxes={boxes}
              selectedId={selectedBox}
              tool={tool}
              readOnly={!canEdit || Boolean(isReview)}
              classOrder={taskClasses}
              defaultClass={drawClass()}
              hiddenBoxIds={hiddenBoxIds}
              onSelect={selectBox}
              onCreateBox={addBox}
              onCreateSegment={addSegment}
              onUpdateBox={updateBoxGeometry}
            />
            <div className="anno-float-tools">
              <button
                type="button"
                className={`anno-float-btn ${tool === "box" ? "active" : ""} ${boxTrackMode ? "track-on" : ""}`}
                onClick={() => {
                  blurAnnotationFields();
                  setTool("box");
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!canEdit || isReview) return;
                  setBoxTrackMode((v) => !v);
                }}
                disabled={!canEdit || Boolean(isReview)}
                title={
                  boxTrackMode
                    ? "Box (B) — track BẬT: copy box sang các frame sau. Alt+B tắt track. Chuột phải: bật/tắt track."
                    : "Box (B). Alt+B bật/tắt track. Chuột phải: bật/tắt track."
                }
              >
                <IconBox size={14} />
              </button>
              <button
                type="button"
                className={`anno-float-btn ${tool === "segment" ? "active" : ""} ${segmentTrackMode ? "track-on" : ""}`}
                onClick={() => {
                  blurAnnotationFields();
                  setTool("segment");
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!canEdit || isReview) return;
                  setSegmentTrackMode((v) => !v);
                }}
                disabled={!canEdit || Boolean(isReview)}
                title={
                  segmentTrackMode
                    ? "Segment (S) — track BẬT. Alt+S tắt track. Enter đóng (≥3 điểm)."
                    : "Segment (S) — Enter đóng (≥3 điểm). Alt+S bật/tắt track."
                }
              >
                <IconSegment size={14} />
              </button>
              <button
                type="button"
                className={`anno-float-btn ${tool === "hand" ? "active" : ""}`}
                onClick={() => {
                  blurAnnotationFields();
                  setTool("hand");
                }}
                title="Hand (H) — kéo/chỉnh box & segment; Ctrl+kéo pan; Shift+click chọn box phía dưới; double-click fit ảnh 100%"
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
                value={imageCaptionDraft}
                placeholder={
                  !canEdit || isReview ? "Không thể chỉnh sửa" : "Nhập image caption..."
                }
                disabled={!canEdit || Boolean(isReview)}
                onFocus={() => setFocusField("imageCaption")}
                onChange={(e) => setImageCaptionDraft(e.target.value)}
              />
            </div>
            <div className={`anno-field anno-field-oneline ${focusField === "boxCaption" ? "focused" : ""}`}>
              <label>Box caption</label>
              <textarea
                ref={boxCaptionRef}
                rows={1}
                className="anno-oneline-input pretty-scroll"
                lang="vi"
                value={boxCaptionDraft}
                placeholder={
                  !selected
                    ? "Chọn box"
                    : !canEdit || isReview
                      ? "Không thể chỉnh sửa"
                      : "Nhập box caption..."
                }
                disabled={!selected || !canEdit || Boolean(isReview)}
                onFocus={() => setFocusField("boxCaption")}
                onChange={(e) => setBoxCaptionDraft(e.target.value)}
              />
            </div>
            <div className={`anno-field anno-field-oneline ${focusField === "ocr" ? "focused" : ""}`}>
              <label>OCR text</label>
              <textarea
                ref={ocrRef}
                rows={1}
                className="anno-oneline-input pretty-scroll"
                lang="vi"
                value={ocrDraft}
                placeholder={
                  !selected
                    ? "Chọn box"
                    : !canEdit || isReview
                      ? "Không thể chỉnh sửa"
                      : "Nhập OCR..."
                }
                disabled={!selected || !canEdit || Boolean(isReview)}
                onFocus={() => setFocusField("ocr")}
                onChange={(e) => setOcrDraft(e.target.value)}
              />
            </div>
            <div className={`anno-field anno-field-class ${focusField === "class" ? "focused" : ""}`}>
              <label>Class</label>
              {selected ? (
                <ClassCombobox
                  classes={taskClasses}
                  value={classDraft}
                  disabled={!canEdit || Boolean(isReview)}
                  placeholder="Class..."
                  classIndex={classIndex}
                  onChange={(c) => {
                    setClassDraft(c);
                    if (selectedBox && canEdit && !isReview) {
                      void flushBoxFields(selectedBox, {
                        caption: boxCaptionDraft,
                        ocr: ocrDraft,
                        className: c,
                      });
                    }
                  }}
                  onCommitNew={(c) => commitClass(c)}
                  onFocusField={() => setFocusField("class")}
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
            <div className="anno-box-list pretty-scroll" ref={boxListRef}>
              {boxes.length === 0 && <span className="anno-muted">—</span>}
              {boxes.map((b) => {
                const hidden = hiddenBoxIds.has(b.id);
                return (
                  <div
                    key={b.id}
                    data-box-id={b.id}
                    className={`anno-box-row ${selectedBox === b.id ? "selected" : ""} ${hidden ? "hidden-box" : ""}`}
                  >
                    <button
                      type="button"
                      className="anno-box-row-main"
                      onClick={() => selectBox(b.id)}
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
            <div className="anno-task-class-search-wrap">
              <input
                type="search"
                className="anno-task-class-search anno-oneline-input pretty-scroll"
                lang="vi"
                value={taskClassFilter}
                placeholder="Tìm class…"
                autoComplete="off"
                onChange={(e) => setTaskClassFilter(e.target.value)}
                onFocus={() => setFocusField(null)}
              />
              {taskClassFilter.trim() ? (
                <button
                  type="button"
                  className="btn-x anno-task-class-search-clear"
                  title="Xóa tìm kiếm"
                  aria-label="Xóa tìm kiếm"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setTaskClassFilter("")}
                >
                  ×
                </button>
              ) : null}
            </div>
            <div className="anno-chip-row anno-chip-row-scroll anno-task-class-list pretty-scroll">
              {taskClasses.length === 0 && <span className="anno-muted">—</span>}
              {taskClasses.length > 0 && filteredTaskClasses.length === 0 && (
                <span className="anno-muted">Không khớp</span>
              )}
              {filteredTaskClasses.map((c) => {
                const border = colorOf(c);
                const active =
                  selectedBox != null
                    ? (selected?.class || "").toLowerCase() === c.toLowerCase()
                    : defaultDrawClass.toLowerCase() === c.toLowerCase();
                return (
                  <ColoredOutlineChip
                    key={c}
                    label={c}
                    color={border}
                    active={active}
                    onLabelClick={() => selectTaskClass(c)}
                    onRemove={canEdit ? () => void removeTaskClass(c) : undefined}
                    removeDisabled={!canEdit}
                  />
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
                    role="button"
                    tabIndex={0}
                    className={`anno-chip with-x anno-chip-clickable ${activeImageTag === t ? "active" : ""}`}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest(".anno-chip-x")) return;
                      focusFromImageTag(t);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        focusFromImageTag(t);
                      }
                    }}
                  >
                    <span className="anno-chip-label">{t}</span>
                    {t !== "Accept S1" && t !== "Accept All" && (
                      <button
                        type="button"
                        className="anno-chip-x"
                        title="Đánh dấu đã sửa (xóa tag)"
                        disabled={!canClear}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
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
                          onMouseDown={(ev) => {
                            ev.preventDefault();
                            ev.stopPropagation();
                          }}
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

      {boxContextMenu && (
        <div
          className="anno-context-menu"
          style={{ left: boxContextMenu.x, top: boxContextMenu.y }}
          role="menu"
        >
          <button
            type="button"
            className="anno-context-menu-item"
            role="menuitem"
            onClick={() => {
              setFocusField("boxCaption");
              setBoxContextMenu(null);
            }}
          >
            Box caption <kbd>C</kbd>
          </button>
          <button
            type="button"
            className="anno-context-menu-item"
            role="menuitem"
            onClick={() => {
              setFocusField("ocr");
              setBoxContextMenu(null);
            }}
          >
            OCR text <kbd>O</kbd>
          </button>
        </div>
      )}
    </div>
  );
}
