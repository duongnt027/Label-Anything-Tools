import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box as BoxType } from "../api";
import { isSegmentAnnotation } from "../utils/boxPayload";
import { buildClassColorIndex, classColorForName } from "../utils/classColors";
import { getCachedImage, preloadImageUrl } from "../utils/imagePrefetch";

export type AnnotateTool = "box" | "segment" | "hand";
export type ShapeFilter = "all" | "box" | "segment" | "none";

const LINE_W = 1;
const POINT_R = 3;
const HIT_CORNER = 8;
const HIT_VERTEX = 8;
/** Minimum box width/height on screen when drawing (px). */
const MIN_BOX_PX = 4;

type Pt = { x: number; y: number };

function parseBox(box_points: string) {
  const [xc, yc, w, h] = box_points.split(" ").map(Number);
  return { xc: xc || 0, yc: yc || 0, w: w || 0, h: h || 0 };
}

function parseSegment(segment_points: string): Pt[] {
  const parts = segment_points.trim().split(/\s+/).map(Number).filter((n) => !Number.isNaN(n));
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) pts.push({ x: parts[i], y: parts[i + 1] });
  return pts;
}

function formatBox(b: { xc: number; yc: number; w: number; h: number }) {
  return `${b.xc} ${b.yc} ${b.w} ${b.h}`;
}

function formatSegment(pts: Pt[]) {
  return pts.map((p) => `${p.x} ${p.y}`).join(" ");
}

function clampNorm(v: number) {
  return Math.min(1, Math.max(0, v));
}

function clampNormPt(ix: number, iy: number) {
  return { ix: clampNorm(ix), iy: clampNorm(iy) };
}

function isInsideImage(ix: number, iy: number) {
  return ix >= 0 && ix <= 1 && iy >= 0 && iy <= 1;
}

/** Box from drag corners, clamped to the image bounds [0, 1]. */
function boxFromDragCorners(x0: number, y0: number, x1: number, y1: number) {
  const ax = clampNorm(x0);
  const ay = clampNorm(y0);
  const bx = clampNorm(x1);
  const by = clampNorm(y1);
  const left = Math.min(ax, bx);
  const right = Math.max(ax, bx);
  const top = Math.min(ay, by);
  const bottom = Math.max(ay, by);
  return {
    xc: (left + right) / 2,
    yc: (top + bottom) / 2,
    w: right - left,
    h: bottom - top,
  };
}

function bboxFromPts(pts: Pt[]) {
  if (!pts.length) return { xc: 0.5, yc: 0.5, w: 0.01, h: 0.01 };
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    xc: (minX + maxX) / 2,
    yc: (minY + maxY) / 2,
    w: Math.max(0.005, maxX - minX),
    h: Math.max(0.005, maxY - minY),
  };
}

type Corner = "nw" | "ne" | "sw" | "se";

type DragState =
  | { kind: "pan"; x: number; y: number }
  | { kind: "draw"; x: number; y: number }
  | {
      kind: "move";
      id: number;
      startIx: number;
      startIy: number;
      orig: { xc: number; yc: number; w: number; h: number };
      origSegs?: Pt[];
    }
  | {
      kind: "resize";
      id: number;
      corner: Corner;
      orig: { xc: number; yc: number; w: number; h: number };
    }
  | {
      kind: "vertex";
      id: number;
      index: number;
      origSegs: Pt[];
    };

type GeometryPatch = { box_points?: string; segment_points?: string };

type Props = {
  imageUrl: string;
  /** When set, boxes are only drawn after this image is loaded (avoids box/image mismatch). */
  imageId?: number;
  boxes: BoxType[];
  selectedId: number | null;
  tool: AnnotateTool;
  readOnly?: boolean;
  classOrder?: string[];
  defaultClass?: string;
  /** When set, all boxes/segments use this stroke color (review stage 1). */
  uniformStrokeColor?: string;
  hiddenBoxIds?: ReadonlySet<number>;
  /** When set, only matching shapes are drawn / hit-tested. */
  shapeFilter?: ShapeFilter;
  /** Hand-tool edits box rect or segment polygon when both exist. */
  interactionTarget?: "auto" | "box" | "segment";
  /** When true, pan/zoom via drag or wheel is disabled (geometry edit only). */
  disablePan?: boolean;
  /** When set, initial view zooms to this normalized viewport (xc, yc, w, h). */
  cropView?: { xc: number; yc: number; w: number; h: number };
  onSelect: (id: number | null) => void;
  onCreateBox?: (points: string) => void;
  onCreateSegment?: (points: string) => void;
  onUpdateBox?: (id: number, patch: GeometryPatch) => void;
};

export type AnnotationCanvasHandle = {
  /** Remove last point while drawing a segment; returns true if handled. */
  undoSegmentDraftPoint: () => boolean;
};

const AnnotationCanvas = forwardRef<AnnotationCanvasHandle, Props>(function AnnotationCanvas(
  {
  imageUrl,
  imageId,
  boxes,
  selectedId,
  tool,
  readOnly,
  classOrder = [],
  defaultClass,
  uniformStrokeColor,
  hiddenBoxIds,
  shapeFilter = "all",
  interactionTarget = "auto",
  disablePan,
  cropView,
  onSelect,
  onCreateBox,
  onCreateSegment,
  onUpdateBox,
}: Props,
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgElRef = useRef<HTMLImageElement | null>(getCachedImage(imageUrl));
  const loadedImageIdRef = useRef<number | null>(
    getCachedImage(imageUrl) && imageId != null ? imageId : null,
  );
  const [img, setImg] = useState<HTMLImageElement | null>(() => imgElRef.current);
  const dragRef = useRef<DragState | null>(null);
  const panRef = useRef({ x: 0, y: 0, scale: 1 });
  const segDraftRef = useRef<Pt[]>([]);
  const previewRef = useRef<{ xc: number; yc: number; w: number; h: number } | null>(null);
  const segPreviewRef = useRef<Pt[] | null>(null);
  const mouseRef = useRef<{ px: number; py: number } | null>(null);
  const segMouseRef = useRef<{ px: number; py: number } | null>(null);
  const pendingMoveRef = useRef<{
    id: number;
    startIx: number;
    startIy: number;
    startPx: number;
    startPy: number;
    orig: { xc: number; yc: number; w: number; h: number };
    origSegs?: Pt[];
  } | null>(null);
  const pendingResizeRef = useRef<{
    id: number;
    corner: Corner;
    startPx: number;
    startPy: number;
    orig: { xc: number; yc: number; w: number; h: number };
  } | null>(null);
  const rafDrawRef = useRef<number | null>(null);
  const [stackOrder, setStackOrder] = useState<number[]>([]);

  const orderedBoxes = useMemo(() => {
    const byId = new Map(boxes.map((b) => [b.id, b]));
    const out: BoxType[] = [];
    for (const id of stackOrder) {
      const b = byId.get(id);
      if (b) {
        out.push(b);
        byId.delete(id);
      }
    }
    for (const b of byId.values()) out.push(b);
    return out;
  }, [boxes, stackOrder]);

  const boxesRef = useRef(orderedBoxes);
  boxesRef.current = orderedBoxes;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const imageIdRef = useRef(imageId);
  imageIdRef.current = imageId;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const shapeFilterRef = useRef(shapeFilter);
  shapeFilterRef.current = shapeFilter;
  const interactionTargetRef = useRef(interactionTarget);
  interactionTargetRef.current = interactionTarget;
  const hiddenRef = useRef(hiddenBoxIds);

  const shapeVisible = useCallback((b: BoxType) => {
    const f = shapeFilterRef.current;
    if (f === "all") return true;
    if (f === "none") return false;
    const seg = isSegmentAnnotation(b);
    return f === "segment" ? seg : !seg;
  }, []);
  hiddenRef.current = hiddenBoxIds;
  const [, bump] = useState(0);

  const isHidden = (id: number) => Boolean(hiddenRef.current?.has(id));

  const cropViewRef = useRef(cropView);
  cropViewRef.current = cropView;

  const fitView = useCallback(() => {
    panRef.current = { x: 0, y: 0, scale: 1 };
    bump((n) => n + 1);
  }, []);

  const fitCropView = useCallback(() => {
    const view = cropViewRef.current;
    const wrap = wrapRef.current;
    if (!img || !wrap || !view) {
      fitView();
      return;
    }
    const rect = wrap.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const base = Math.min(rect.width / img.width, rect.height / img.height);
    const cropScale = Math.min(
      rect.width / (view.w * img.width),
      rect.height / (view.h * img.height),
    );
    panRef.current.scale = cropScale / base;
    const s = base * panRef.current.scale;
    panRef.current.x =
      rect.width / 2 - view.xc * img.width * s - (rect.width - img.width * s) / 2;
    panRef.current.y =
      rect.height / 2 - view.yc * img.height * s - (rect.height - img.height * s) / 2;
    bump((n) => n + 1);
  }, [img, fitView]);

  const resetView = useCallback(() => {
    if (cropViewRef.current) fitCropView();
    else fitView();
  }, [fitCropView, fitView]);

  const applyLoadedImage = useCallback(
    (i: HTMLImageElement) => {
      const sameImage =
        imageId != null && loadedImageIdRef.current === imageId && imgElRef.current === i;
      if (sameImage) return;

      const imageChanged = imageId != null && loadedImageIdRef.current !== imageId;
      imgElRef.current = i;
      if (imageId != null) loadedImageIdRef.current = imageId;
      setImg(i);
      if (imageChanged) {
        segDraftRef.current = [];
        previewRef.current = null;
        segPreviewRef.current = null;
        setStackOrder([]);
      }
      bump((n) => n + 1);
    },
    [imageId],
  );

  useLayoutEffect(() => {
    let cancelled = false;
    const cached = getCachedImage(imageUrl);
    if (cached) {
      applyLoadedImage(cached);
      return;
    }
    void preloadImageUrl(imageUrl)
      .then((i) => {
        if (!cancelled) applyLoadedImage(i);
      })
      .catch(() => {
        if (!cancelled) {
          imgElRef.current = null;
          loadedImageIdRef.current = null;
          setImg(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [imageUrl, imageId, applyLoadedImage]);

  useEffect(() => {
    const ids = boxes.map((b) => b.id);
    setStackOrder((prev) => {
      const kept = prev.filter((id) => ids.includes(id));
      const missing = ids.filter((id) => !kept.includes(id));
      if (!prev.length) return ids;
      return [...kept, ...missing];
    });
  }, [boxes]);

  useLayoutEffect(() => {
    if (!img || !cropView) return;
    fitCropView();
  }, [img, cropView, fitCropView]);

  const classIndex = useMemo(() => buildClassColorIndex(classOrder), [classOrder]);
  const colorForClass = (cls: string) =>
    uniformStrokeColor || classColorForName(cls, classIndex);

  const draftStroke = () =>
    uniformStrokeColor || colorForClass(defaultClass || classOrder[0] || "default");

  const viewTransform = useCallback(() => {
    const wrap = wrapRef.current!;
    const rect = wrap.getBoundingClientRect();
    const base = Math.min(rect.width / img!.width, rect.height / img!.height);
    const scale = base * panRef.current.scale;
    const ox = (rect.width - img!.width * scale) / 2 + panRef.current.x;
    const oy = (rect.height - img!.height * scale) / 2 + panRef.current.y;
    return { rect, base, scale, ox, oy };
  }, [img]);

  const draggingBoxId = () => {
    const d = dragRef.current;
    if (!d || d.kind === "pan" || d.kind === "draw") return null;
    return d.id;
  };

  const drawBoxShape = (
    ctx: CanvasRenderingContext2D,
    b: BoxType,
    scale: number,
    ox: number,
    oy: number,
    selected: boolean,
  ) => {
    const stroke = colorForClass(b.class);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = LINE_W;
    ctx.fillStyle = selected ? stroke : "transparent";

    const segs = parseSegment(b.segment_points || "");
    if (segs.length >= 2) {
      ctx.beginPath();
      segs.forEach((p, i) => {
        const px = p.x * img!.width * scale + ox;
        const py = p.y * img!.height * scale + oy;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.stroke();
      if (selected) {
        ctx.save();
        ctx.globalAlpha = 0.12;
        ctx.fill();
        ctx.restore();
        segs.forEach((p) => {
          const px = p.x * img!.width * scale + ox;
          const py = p.y * img!.height * scale + oy;
          drawPoint(ctx, px, py, stroke);
        });
      }
    } else if (b.box_points) {
      const { xc, yc, w, h } = parseBox(b.box_points);
      const x = (xc - w / 2) * img!.width * scale + ox;
      const y = (yc - h / 2) * img!.height * scale + oy;
      const bw = w * img!.width * scale;
      const bh = h * img!.height * scale;
      ctx.strokeRect(x, y, bw, bh);
      if (selected) {
        ctx.save();
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = stroke;
        ctx.fillRect(x, y, bw, bh);
        ctx.restore();
        drawPoint(ctx, x, y, stroke);
        drawPoint(ctx, x + bw, y, stroke);
        drawPoint(ctx, x, y + bh, stroke);
        drawPoint(ctx, x + bw, y + bh, stroke);
      }
    }
  };

  const drawPoint = (ctx: CanvasRenderingContext2D, px: number, py: number, fill: string) => {
    ctx.fillStyle = fill;
    ctx.strokeStyle = "#0b0f17";
    ctx.lineWidth = LINE_W;
    ctx.beginPath();
    ctx.arc(px, py, POINT_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !img) return;
    const { rect, scale, ox, oy } = (() => {
      const r = wrap.getBoundingClientRect();
      const base = Math.min(r.width / img.width, r.height / img.height);
      const s = base * panRef.current.scale;
      return {
        rect: r,
        scale: s,
        ox: (r.width - img.width * s) / 2 + panRef.current.x,
        oy: (r.height - img.height * s) / 2 + panRef.current.y,
      };
    })();
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, ox, oy, img.width * scale, img.height * scale);

    const activeImageId = imageIdRef.current;
    const renderBoxes = boxesRef.current.filter(
      (b) => activeImageId == null || b.img_id == null || b.img_id === activeImageId,
    );

    const skipId = draggingBoxId();
    const selected = selectedIdRef.current;

    renderBoxes.forEach((b) => {
      if (b.id === skipId) return;
      if (hiddenBoxIds?.has(b.id)) return;
      if (!shapeVisible(b)) return;
      drawBoxShape(ctx, b, scale, ox, oy, b.id === selected);
    });

    const skipBox = skipId != null ? boxesRef.current.find((x) => x.id === skipId) : null;
    const strokePreview = colorForClass(skipBox?.class || defaultClass || "");
    const segPreview = segPreviewRef.current;
    if (segPreview && segPreview.length >= 2 && skipId) {
      ctx.strokeStyle = strokePreview;
      ctx.lineWidth = LINE_W;
      ctx.beginPath();
      segPreview.forEach((p, i) => {
        const px = p.x * img.width * scale + ox;
        const py = p.y * img.height * scale + oy;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = strokePreview;
      ctx.fill();
      ctx.restore();
      segPreview.forEach((p) => {
        drawPoint(ctx, p.x * img.width * scale + ox, p.y * img.height * scale + oy, strokePreview);
      });
    } else {
      const preview = previewRef.current;
      if (preview && skipId) {
        ctx.strokeStyle = strokePreview;
        ctx.lineWidth = LINE_W;
        ctx.strokeRect(
          (preview.xc - preview.w / 2) * img.width * scale + ox,
          (preview.yc - preview.h / 2) * img.height * scale + oy,
          preview.w * img.width * scale,
          preview.h * img.height * scale,
        );
      }
    }

    const draft = segDraftRef.current;
    if (draft.length) {
      const stroke = draftStroke();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = LINE_W + 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      draft.forEach((p, i) => {
        const px = p.x * img.width * scale + ox;
        const py = p.y * img.height * scale + oy;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      const segMouse = segMouseRef.current;
      if (segMouse && toolRef.current === "segment") {
        const last = draft[draft.length - 1];
        const lx = last.x * img.width * scale + ox;
        const ly = last.y * img.height * scale + oy;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(segMouse.px, segMouse.py);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      draft.forEach((p) => {
        const px = p.x * img.width * scale + ox;
        const py = p.y * img.height * scale + oy;
        drawPoint(ctx, px, py, stroke);
      });
      ctx.lineWidth = LINE_W;
    }

    if (toolRef.current === "box" && mouseRef.current && !dragRef.current && !readOnly) {
      const { px, py } = mouseRef.current;
      ctx.strokeStyle = "rgba(148, 163, 184, 0.45)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, canvas.height);
      ctx.moveTo(0, py);
      ctx.lineTo(canvas.width, py);
      ctx.stroke();
    }

    if (dragRef.current?.kind === "draw" && previewRef.current) {
      const p = previewRef.current;
      ctx.strokeStyle = draftStroke();
      ctx.lineWidth = LINE_W + 1;
      ctx.strokeRect(
        (p.xc - p.w / 2) * img.width * scale + ox,
        (p.yc - p.h / 2) * img.height * scale + oy,
        p.w * img.width * scale,
        p.h * img.height * scale,
      );
      ctx.lineWidth = LINE_W;
    }
  }, [
    img,
    classOrder,
    defaultClass,
    uniformStrokeColor,
    readOnly,
    classIndex,
    hiddenBoxIds,
    shapeVisible,
  ]);

  useEffect(() => {
    draw();
  }, [stackOrder, draw]);

  const scheduleDraw = useCallback(() => {
    if (rafDrawRef.current != null) return;
    rafDrawRef.current = requestAnimationFrame(() => {
      rafDrawRef.current = null;
      draw();
    });
  }, [draw]);

  useEffect(() => {
    draw();
  }, [draw]);

  const prevBoxCountRef = useRef(boxes.length);
  useEffect(() => {
    if (boxes.length > prevBoxCountRef.current) {
      segDraftRef.current = [];
      previewRef.current = null;
      draw();
    }
    prevBoxCountRef.current = boxes.length;
  }, [boxes.length, draw]);

  useEffect(() => {
    if (tool !== "box") mouseRef.current = null;
    if (tool !== "segment") {
      segDraftRef.current = [];
      segMouseRef.current = null;
    }
    draw();
  }, [tool, draw]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => {
      if (cropViewRef.current) fitCropView();
      draw();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [draw, fitCropView]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheel = (e: WheelEvent) => {
      if (!img || disablePan) return;
      e.preventDefault();
      const { rect, scale, ox, oy } = viewTransform();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const imgX = (mx - ox) / scale;
      const imgY = (my - oy) / scale;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const next = Math.min(20, Math.max(0.2, panRef.current.scale * factor));
      const base = Math.min(rect.width / img.width, rect.height / img.height);
      const newScale = base * next;
      panRef.current.scale = next;
      panRef.current.x = mx - imgX * newScale - (rect.width - img.width * newScale) / 2;
      panRef.current.y = my - imgY * newScale - (rect.height - img.height * newScale) / 2;
      draw();
    };
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheel);
  }, [img, draw, viewTransform, disablePan]);

  const finishSegment = useCallback(() => {
    const draft = segDraftRef.current;
    if (draft.length < 3) return;
    const points = draft.map((p) => `${p.x} ${p.y}`).join(" ");
    if (onCreateSegment) onCreateSegment(points);
    bump((n) => n + 1);
    draw();
  }, [onCreateSegment, draw]);

  useImperativeHandle(
    ref,
    () => ({
      undoSegmentDraftPoint: () => {
        if (readOnly) return false;
        if (toolRef.current !== "segment") return false;
        const draft = segDraftRef.current;
        if (draft.length === 0) return false;
        segDraftRef.current = draft.slice(0, -1);
        bump((n) => n + 1);
        draw();
        return true;
      },
    }),
    [readOnly, draw],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "Enter" && toolRef.current === "segment" && !readOnly) {
        e.preventDefault();
        finishSegment();
      }
      if (e.key === "Escape" && toolRef.current === "segment") {
        segDraftRef.current = [];
        bump((n) => n + 1);
        draw();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [readOnly, finishSegment, draw]);

  const normFromEvent = (e: { clientX: number; clientY: number }) => {
    const { scale, ox, oy, rect } = viewTransform();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const ix = (px - ox) / (img!.width * scale);
    const iy = (py - oy) / (img!.height * scale);
    return { ix, iy, scale, ox, oy, rect, px, py };
  };

  const boxHitsAt = (ix: number, iy: number) => {
    const hits: number[] = [];
    const list = boxesRef.current;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      if (isHidden(b.id)) continue;
      if (!shapeVisible(b)) continue;
      const segs = parseSegment(b.segment_points || "");
      const target = interactionTargetRef.current;
      const useSegment =
        segs.length >= 3 &&
        (target === "segment" || (target === "auto" && isSegmentAnnotation(b)));
      let inside = false;
      if (useSegment) {
        inside = pointInPoly(ix, iy, segs);
      } else {
        const { xc, yc, w, h } = parseBox(b.box_points);
        inside =
          ix >= xc - w / 2 && ix <= xc + w / 2 && iy >= yc - h / 2 && iy <= yc + h / 2;
      }
      if (inside) hits.push(b.id);
    }
    return hits;
  };

  const sendBoxToBack = (boxId: number) => {
    setStackOrder((prev) => {
      const rest = prev.filter((id) => id !== boxId);
      return [boxId, ...rest];
    });
  };

  const beginHandBoxDrag = (hit: number, ix: number, iy: number, px: number, py: number) => {
    onSelect(hit);
    const box = boxesRef.current.find((b) => b.id === hit)!;
    const target = interactionTargetRef.current;
    const segs = parseSegment(box.segment_points || "");
    const useSeg =
      segs.length >= 2 &&
      (target === "segment" || (target === "auto" && isSegmentAnnotation(box)));
    pendingMoveRef.current = {
      id: hit,
      startIx: ix,
      startIy: iy,
      startPx: px,
      startPy: py,
      orig: parseBox(box.box_points),
      origSegs: useSeg ? segs.map((p) => ({ ...p })) : undefined,
    };
  };

  const hitCorner = (px: number, py: number, box: BoxType): Corner | null => {
    if (!img) return null;
    const { scale, ox, oy } = viewTransform();
    const { xc, yc, w, h } = parseBox(box.box_points);
    const x = (xc - w / 2) * img.width * scale + ox;
    const y = (yc - h / 2) * img.height * scale + oy;
    const bw = w * img.width * scale;
    const bh = h * img.height * scale;
    const corners: { c: Corner; x: number; y: number }[] = [
      { c: "nw", x, y },
      { c: "ne", x: x + bw, y },
      { c: "sw", x, y: y + bh },
      { c: "se", x: x + bw, y: y + bh },
    ];
    for (const corner of corners) {
      if (Math.hypot(px - corner.x, py - corner.y) <= HIT_CORNER) return corner.c;
    }
    return null;
  };

  const hitVertex = (px: number, py: number, segs: Pt[]): number | null => {
    if (!img) return null;
    const { scale, ox, oy } = viewTransform();
    for (let i = 0; i < segs.length; i++) {
      const vx = segs[i].x * img.width * scale + ox;
      const vy = segs[i].y * img.height * scale + oy;
      if (Math.hypot(px - vx, py - vy) <= HIT_VERTEX) return i;
    }
    return null;
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (!img) return;
    e.preventDefault();

    if (e.detail >= 2) {
      e.preventDefault();
      resetView();
      draw();
      return;
    }

    if (readOnly) {
      if (!disablePan && (e.ctrlKey || tool === "hand")) {
        dragRef.current = { kind: "pan", x: e.clientX, y: e.clientY };
      }
      return;
    }

    if (!disablePan && e.ctrlKey) {
      dragRef.current = { kind: "pan", x: e.clientX, y: e.clientY };
      return;
    }

    const { ix, iy, px, py } = normFromEvent(e);

    if (tool === "box") {
      if (!isInsideImage(ix, iy)) return;
      dragRef.current = { kind: "draw", x: ix, y: iy };
      draw();
      return;
    }

    if (tool === "segment") {
      if (segDraftRef.current.length === 0 && !isInsideImage(ix, iy)) return;
      const { ix: cx, iy: cy } = clampNormPt(ix, iy);
      segDraftRef.current = [...segDraftRef.current, { x: cx, y: cy }];
      bump((n) => n + 1);
      draw();
      return;
    }

    if (tool === "hand") {
      const selected = selectedId ? boxesRef.current.find((b) => b.id === selectedId) : null;
      if (tool === "hand" && selected && !isHidden(selected.id)) {
        const target = interactionTargetRef.current;
        const segs = parseSegment(selected.segment_points || "");
        const useSegmentVerts =
          segs.length >= 2 &&
          (target === "segment" || (target === "auto" && isSegmentAnnotation(selected)));
        if (useSegmentVerts) {
          const vi = hitVertex(px, py, segs);
          if (vi != null) {
            dragRef.current = {
              kind: "vertex",
              id: selected.id,
              index: vi,
              origSegs: segs.map((p) => ({ ...p })),
            };
            segPreviewRef.current = segs.map((p) => ({ ...p }));
            return;
          }
        } else {
          const corner = hitCorner(px, py, selected);
          if (corner) {
            pendingResizeRef.current = {
              id: selected.id,
              corner,
              startPx: px,
              startPy: py,
              orig: parseBox(selected.box_points),
            };
            return;
          }
        }
      }

      const hits = boxHitsAt(ix, iy);
      if (tool === "hand" && e.shiftKey && hits.length >= 2) {
        const topId = hits[0];
        const nextId = hits[1];
        sendBoxToBack(topId);
        beginHandBoxDrag(nextId, ix, iy, px, py);
        scheduleDraw();
        return;
      }

      const hit = hits[0] ?? null;
      if (hit) {
        beginHandBoxDrag(hit, ix, iy, px, py);
        return;
      }

      onSelect(null);
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!img) return;
    const { ix, iy, px, py, scale, ox, oy } = normFromEvent(e);
    if (toolRef.current === "box" && !readOnly) {
      mouseRef.current = { px, py };
    }
    if (toolRef.current === "segment" && !readOnly) {
      const { ix: cx, iy: cy } = clampNormPt(ix, iy);
      segMouseRef.current = {
        px: cx * img.width * scale + ox,
        py: cy * img.height * scale + oy,
      };
    }

    const pending = pendingMoveRef.current;
    if (pending && !dragRef.current && toolRef.current === "hand") {
      if (Math.hypot(px - pending.startPx, py - pending.startPy) >= 4) {
        dragRef.current = {
          kind: "move",
          id: pending.id,
          startIx: pending.startIx,
          startIy: pending.startIy,
          orig: pending.orig,
          origSegs: pending.origSegs,
        };
        if (pending.origSegs?.length) {
          segPreviewRef.current = pending.origSegs.map((p) => ({ ...p }));
        } else {
          previewRef.current = { ...pending.orig };
        }
        pendingMoveRef.current = null;
      }
    }

    const pendingResize = pendingResizeRef.current;
    if (pendingResize && !dragRef.current && toolRef.current === "hand") {
      if (Math.hypot(px - pendingResize.startPx, py - pendingResize.startPy) >= 4) {
        dragRef.current = {
          kind: "resize",
          id: pendingResize.id,
          corner: pendingResize.corner,
          orig: pendingResize.orig,
        };
        previewRef.current = { ...pendingResize.orig };
        pendingResizeRef.current = null;
      }
    }

    if (!dragRef.current) {
      if (toolRef.current === "box" || toolRef.current === "segment") scheduleDraw();
      return;
    }

    const drag = dragRef.current;

    if (drag.kind === "pan") {
      panRef.current.x += e.clientX - drag.x;
      panRef.current.y += e.clientY - drag.y;
      dragRef.current = { kind: "pan", x: e.clientX, y: e.clientY };
      scheduleDraw();
      return;
    }

    if (drag.kind === "draw") {
      const { ix: cx, iy: cy } = clampNormPt(ix, iy);
      previewRef.current = boxFromDragCorners(drag.x, drag.y, cx, cy);
      scheduleDraw();
      return;
    }

    if (drag.kind === "move") {
      const dx = ix - drag.startIx;
      const dy = iy - drag.startIy;
      if (drag.origSegs?.length) {
        segPreviewRef.current = drag.origSegs.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      } else {
        previewRef.current = {
          xc: drag.orig.xc + dx,
          yc: drag.orig.yc + dy,
          w: drag.orig.w,
          h: drag.orig.h,
        };
      }
      scheduleDraw();
      return;
    }

    if (drag.kind === "vertex") {
      const next = drag.origSegs.map((p, i) =>
        i === drag.index
          ? { x: Math.min(1, Math.max(0, ix)), y: Math.min(1, Math.max(0, iy)) }
          : { ...p },
      );
      segPreviewRef.current = next;
      scheduleDraw();
      return;
    }

    if (drag.kind === "resize") {
      const { xc, yc, w, h } = drag.orig;
      let x1 = xc - w / 2;
      let y1 = yc - h / 2;
      let x2 = xc + w / 2;
      let y2 = yc + h / 2;
      if (drag.corner.includes("w")) x1 = ix;
      if (drag.corner.includes("e")) x2 = ix;
      if (drag.corner.includes("n")) y1 = iy;
      if (drag.corner.includes("s")) y2 = iy;
      const nx1 = Math.min(x1, x2);
      const nx2 = Math.max(x1, x2);
      const ny1 = Math.min(y1, y2);
      const ny2 = Math.max(y1, y2);
      previewRef.current = {
        xc: (nx1 + nx2) / 2,
        yc: (ny1 + ny2) / 2,
        w: Math.max(0.005, nx2 - nx1),
        h: Math.max(0.005, ny2 - ny1),
      };
      scheduleDraw();
    }
  };

  const onMouseUp = (e: React.MouseEvent) => {
    pendingMoveRef.current = null;
    pendingResizeRef.current = null;
    if (!dragRef.current || !img) {
      dragRef.current = null;
      previewRef.current = null;
      segPreviewRef.current = null;
      return;
    }
    const drag = dragRef.current;
    dragRef.current = null;

    if (drag.kind === "pan") {
      previewRef.current = null;
      segPreviewRef.current = null;
      return;
    }

    if (drag.kind === "draw" && onCreateBox) {
      const { ix, iy, scale } = normFromEvent(e);
      const { ix: cx, iy: cy } = clampNormPt(ix, iy);
      const { xc, yc, w, h } = boxFromDragCorners(drag.x, drag.y, cx, cy);
      const wPx = w * img.width * scale;
      const hPx = h * img.height * scale;
      if (wPx >= MIN_BOX_PX && hPx >= MIN_BOX_PX) {
        previewRef.current = null;
        onCreateBox(`${xc} ${yc} ${w} ${h}`);
      } else {
        previewRef.current = null;
      }
      draw();
      return;
    }

    if (drag.kind === "vertex" && onUpdateBox && segPreviewRef.current) {
      const pts = segPreviewRef.current;
      onUpdateBox(drag.id, {
        segment_points: formatSegment(pts),
        box_points: formatBox(bboxFromPts(pts)),
      });
      segPreviewRef.current = null;
      draw();
      return;
    }

    if (drag.kind === "move" && onUpdateBox) {
      const { ix, iy } = normFromEvent(e);
      const dx = ix - drag.startIx;
      const dy = iy - drag.startIy;
      if (Math.abs(dx) >= 0.0005 || Math.abs(dy) >= 0.0005) {
        if (drag.origSegs?.length) {
          const pts = drag.origSegs.map((p) => ({ x: p.x + dx, y: p.y + dy }));
          onUpdateBox(drag.id, {
            segment_points: formatSegment(pts),
            box_points: formatBox(bboxFromPts(pts)),
          });
        } else {
          onUpdateBox(drag.id, {
            box_points: formatBox({
              xc: drag.orig.xc + dx,
              yc: drag.orig.yc + dy,
              w: drag.orig.w,
              h: drag.orig.h,
            }),
          });
        }
      }
      previewRef.current = null;
      segPreviewRef.current = null;
      draw();
      return;
    }

    if (drag.kind === "resize" && onUpdateBox && previewRef.current) {
      onUpdateBox(drag.id, { box_points: formatBox(previewRef.current) });
    }
    previewRef.current = null;
    segPreviewRef.current = null;
    draw();
  };

  let cursor = "default";
  if (!readOnly) {
    if (tool === "segment") cursor = "cell";
    else if (tool === "box") cursor = "crosshair";
    else cursor = "default";
  }

  return (
    <div className="canvas-area" ref={wrapRef}>
      {!img && <div className="canvas-loading">Đang tải ảnh...</div>}
      <canvas
        ref={canvasRef}
        onMouseEnter={(e) => {
          if (!img || readOnly || toolRef.current !== "box") return;
          const { px, py } = normFromEvent(e);
          mouseRef.current = { px, py };
          draw();
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => {
          dragRef.current = null;
          previewRef.current = null;
          segPreviewRef.current = null;
          mouseRef.current = null;
          pendingMoveRef.current = null;
          pendingResizeRef.current = null;
          draw();
        }}
        onDoubleClick={(e) => {
          e.preventDefault();
          resetView();
          draw();
        }}
        style={{ cursor }}
      />
    </div>
  );
});

export default AnnotationCanvas;

function pointInPoly(x: number, y: number, pts: { x: number; y: number }[]) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x;
    const yi = pts[i].y;
    const xj = pts[j].x;
    const yj = pts[j].y;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
