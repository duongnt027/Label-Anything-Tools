import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box as BoxType } from "../api";
import { buildClassColorIndex, classColorForName } from "../utils/classColors";

export type AnnotateTool = "box" | "segment" | "hand";

const LINE_W = 1;
const POINT_R = 3;
const HIT_CORNER = 8;
const HIT_VERTEX = 8;

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
  boxes: BoxType[];
  selectedId: number | null;
  tool: AnnotateTool;
  readOnly?: boolean;
  classOrder?: string[];
  defaultClass?: string;
  /** When set, all boxes/segments use this stroke color (review stage 1). */
  uniformStrokeColor?: string;
  hiddenBoxIds?: ReadonlySet<number>;
  onSelect: (id: number | null) => void;
  onCreateBox?: (points: string) => void;
  onCreateSegment?: (points: string) => void;
  onUpdateBox?: (id: number, patch: GeometryPatch) => void;
  onAfterCreate?: () => void;
};

export default function AnnotationCanvas({
  imageUrl,
  boxes,
  selectedId,
  tool,
  readOnly,
  classOrder = [],
  defaultClass,
  uniformStrokeColor,
  hiddenBoxIds,
  onSelect,
  onCreateBox,
  onCreateSegment,
  onUpdateBox,
  onAfterCreate,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
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
  const boxesRef = useRef(boxes);
  boxesRef.current = boxes;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const hiddenRef = useRef(hiddenBoxIds);
  hiddenRef.current = hiddenBoxIds;
  const [, bump] = useState(0);

  const isHidden = (id: number) => Boolean(hiddenRef.current?.has(id));

  const fitView = useCallback(() => {
    panRef.current = { x: 0, y: 0, scale: 1 };
    bump((n) => n + 1);
  }, []);

  useEffect(() => {
    const i = new Image();
    i.onload = () => {
      setImg(i);
      panRef.current = { x: 0, y: 0, scale: 1 };
      segDraftRef.current = [];
      previewRef.current = null;
      segPreviewRef.current = null;
      bump((n) => n + 1);
    };
    i.onerror = () => setImg(null);
    i.src = imageUrl;
  }, [imageUrl]);

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

    const skipId = draggingBoxId();

    boxes.forEach((b) => {
      if (b.id === skipId) return;
      if (hiddenBoxIds?.has(b.id)) return;
      drawBoxShape(ctx, b, scale, ox, oy, b.id === selectedId);
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
      ctx.lineWidth = LINE_W;
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
      ctx.lineWidth = LINE_W;
      ctx.strokeRect(
        (p.xc - p.w / 2) * img.width * scale + ox,
        (p.yc - p.h / 2) * img.height * scale + oy,
        p.w * img.width * scale,
        p.h * img.height * scale,
      );
    }
  }, [
    boxes,
    img,
    selectedId,
    classOrder,
    defaultClass,
    uniformStrokeColor,
    readOnly,
    classIndex,
    hiddenBoxIds,
  ]);

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
    const ro = new ResizeObserver(() => draw());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [draw]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheel = (e: WheelEvent) => {
      if (!img) return;
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
  }, [img, draw, viewTransform]);

  const finishSegment = useCallback(() => {
    const draft = segDraftRef.current;
    if (draft.length < 3) return;
    const points = draft.map((p) => `${p.x} ${p.y}`).join(" ");
    segDraftRef.current = [];
    onAfterCreate?.();
    if (onCreateSegment) onCreateSegment(points);
    bump((n) => n + 1);
    draw();
  }, [onCreateSegment, onAfterCreate, draw]);

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

  const hitTest = (ix: number, iy: number) => {
    const list = boxesRef.current;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      if (isHidden(b.id)) continue;
      const segs = parseSegment(b.segment_points || "");
      if (segs.length >= 3) {
        if (pointInPoly(ix, iy, segs)) return b.id;
        continue;
      }
      const { xc, yc, w, h } = parseBox(b.box_points);
      if (ix >= xc - w / 2 && ix <= xc + w / 2 && iy >= yc - h / 2 && iy <= yc + h / 2) return b.id;
    }
    return null;
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

    if (e.ctrlKey && e.detail >= 2) {
      fitView();
      draw();
      return;
    }

    if (readOnly) {
      if (e.ctrlKey || tool === "hand") {
        dragRef.current = { kind: "pan", x: e.clientX, y: e.clientY };
      }
      return;
    }

    if (e.ctrlKey) {
      dragRef.current = { kind: "pan", x: e.clientX, y: e.clientY };
      return;
    }

    const { ix, iy, px, py } = normFromEvent(e);

    if (tool === "segment") {
      const hit = hitTest(ix, iy);
      if (hit && segDraftRef.current.length === 0) {
        onSelect(hit);
        return;
      }
      segDraftRef.current = [...segDraftRef.current, { x: ix, y: iy }];
      bump((n) => n + 1);
      draw();
      return;
    }

    if (tool === "hand" || tool === "box") {
      const selected = selectedId ? boxesRef.current.find((b) => b.id === selectedId) : null;
      if (tool === "hand" && selected && !isHidden(selected.id)) {
        const segs = parseSegment(selected.segment_points || "");
        if (segs.length >= 2) {
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

      const hit = hitTest(ix, iy);
      if (hit) {
        onSelect(hit);
        if (tool === "hand") {
          const box = boxesRef.current.find((b) => b.id === hit)!;
          const segs = parseSegment(box.segment_points || "");
          pendingMoveRef.current = {
            id: hit,
            startIx: ix,
            startIy: iy,
            startPx: px,
            startPy: py,
            orig: parseBox(box.box_points),
            origSegs: segs.length >= 2 ? segs.map((p) => ({ ...p })) : undefined,
          };
        }
        return;
      }

      if (tool === "box") {
        dragRef.current = { kind: "draw", x: ix, y: iy };
        previewRef.current = { xc: ix, yc: iy, w: 0.01, h: 0.01 };
        onSelect(null);
        return;
      }

      onSelect(null);
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!img) return;
    const { ix, iy, px, py } = normFromEvent(e);
    if (toolRef.current === "box" && !readOnly) {
      mouseRef.current = { px, py };
    }
    if (toolRef.current === "segment" && !readOnly) {
      segMouseRef.current = { px, py };
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
      const x0 = drag.x;
      const y0 = drag.y;
      const w = Math.abs(ix - x0);
      const h = Math.abs(iy - y0);
      previewRef.current = { xc: (x0 + ix) / 2, yc: (y0 + iy) / 2, w, h };
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
      const { ix, iy } = normFromEvent(e);
      const w = Math.max(0.01, Math.abs(ix - drag.x));
      const h = Math.max(0.01, Math.abs(iy - drag.y));
      previewRef.current = null;
      if (w >= 0.005 && h >= 0.005) {
        const xc = (drag.x + ix) / 2;
        const yc = (drag.y + iy) / 2;
        onCreateBox(`${xc} ${yc} ${w} ${h}`);
        onAfterCreate?.();
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
          if (e.ctrlKey) {
            e.preventDefault();
            fitView();
            draw();
          }
        }}
        style={{ cursor }}
      />
    </div>
  );
}

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
