import { useCallback, useEffect, useRef, useState } from "react";
import { Box as BoxType } from "../api";

type Tool = "box" | "hand";

function parseBox(box_points: string) {
  const [xc, yc, w, h] = box_points.split(" ").map(Number);
  return { xc, yc, w, h };
}

type Props = {
  imageUrl: string;
  boxes: BoxType[];
  selectedId: number | null;
  tool: Tool;
  readOnly?: boolean;
  onSelect: (id: number | null) => void;
  onCreateBox?: (points: string) => void;
};

export default function AnnotationCanvas({
  imageUrl,
  boxes,
  selectedId,
  tool,
  readOnly,
  onSelect,
  onCreateBox,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; drawing: boolean } | null>(null);
  const panRef = useRef({ x: 0, y: 0, scale: 1 });

  useEffect(() => {
    const i = new Image();
    i.onload = () => setImg(i);
    i.onerror = () => setImg(null);
    i.src = imageUrl;
  }, [imageUrl]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !img) return;
    const rect = wrap.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / img.width, canvas.height / img.height) * panRef.current.scale;
    const ox = (canvas.width - img.width * scale) / 2 + panRef.current.x;
    const oy = (canvas.height - img.height * scale) / 2 + panRef.current.y;
    ctx.drawImage(img, ox, oy, img.width * scale, img.height * scale);
    boxes.forEach((b) => {
      const { xc, yc, w, h } = parseBox(b.box_points);
      const x = (xc - w / 2) * img.width * scale + ox;
      const y = (yc - h / 2) * img.height * scale + oy;
      const bw = w * img.width * scale;
      const bh = h * img.height * scale;
      ctx.strokeStyle = b.id === selectedId ? "#3b82f6" : "#22c55e";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, bw, bh);
      ctx.fillStyle = "rgba(59,130,246,0.15)";
      ctx.fillRect(x, y, bw, bh);
    });
  }, [boxes, img, selectedId]);

  useEffect(() => {
    draw();
  }, [draw]);

  const normFromEvent = (e: React.MouseEvent) => {
    const wrap = wrapRef.current!;
    const rect = wrap.getBoundingClientRect();
    const scale = Math.min(rect.width / img!.width, rect.height / img!.height) * panRef.current.scale;
    const ox = (rect.width - img!.width * scale) / 2 + panRef.current.x;
    const oy = (rect.height - img!.height * scale) / 2 + panRef.current.y;
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const ix = (px - ox) / (img!.width * scale);
    const iy = (py - oy) / (img!.height * scale);
    return { ix, iy, scale, ox, oy, rect };
  };

  const hitTest = (ix: number, iy: number) => {
    for (let i = boxes.length - 1; i >= 0; i--) {
      const b = boxes[i];
      const { xc, yc, w, h } = parseBox(b.box_points);
      if (ix >= xc - w / 2 && ix <= xc + w / 2 && iy >= yc - h / 2 && iy <= yc + h / 2) return b.id;
    }
    return null;
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (!img || readOnly) return;
    e.preventDefault();
    if (tool === "hand") {
      dragRef.current = { x: e.clientX, y: e.clientY, drawing: false };
      return;
    }
    const { ix, iy } = normFromEvent(e);
    const hit = hitTest(ix, iy);
    if (hit) {
      onSelect(hit);
      return;
    }
    dragRef.current = { x: ix, y: iy, drawing: true };
    onSelect(null);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current || !img) return;
    if (tool === "hand") {
      panRef.current.x += e.clientX - dragRef.current.x;
      panRef.current.y += e.clientY - dragRef.current.y;
      dragRef.current = { x: e.clientX, y: e.clientY, drawing: false };
      draw();
      return;
    }
    if (!dragRef.current.drawing) return;
    const { ix, iy, scale, ox, oy } = normFromEvent(e);
    const x0 = dragRef.current.x;
    const y0 = dragRef.current.y;
    const w = Math.abs(ix - x0);
    const h = Math.abs(iy - y0);
    const xc = (x0 + ix) / 2;
    const yc = (y0 + iy) / 2;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    draw();
    ctx.strokeStyle = "#f59e0b";
    ctx.strokeRect(
      (xc - w / 2) * img.width * scale + ox,
      (yc - h / 2) * img.height * scale + oy,
      w * img.width * scale,
      h * img.height * scale,
    );
  };

  const onMouseUp = (e: React.MouseEvent) => {
    if (!dragRef.current || !img || tool === "hand") {
      dragRef.current = null;
      return;
    }
    if (dragRef.current.drawing && onCreateBox) {
      const { ix, iy } = normFromEvent(e);
      const x0 = dragRef.current.x;
      const y0 = dragRef.current.y;
      const w = Math.max(0.01, Math.abs(ix - x0));
      const h = Math.max(0.01, Math.abs(iy - y0));
      const xc = (x0 + ix) / 2;
      const yc = (y0 + iy) / 2;
      onCreateBox(`${xc} ${yc} ${w} ${h}`);
    }
    dragRef.current = null;
    draw();
  };

  return (
    <div className="canvas-area" ref={wrapRef}>
      {!img && <div style={{ padding: 8, color: "#94a3b8" }}>Đang tải ảnh...</div>}
      <canvas
        ref={canvasRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        style={{ cursor: readOnly ? "default" : tool === "hand" ? "grab" : "crosshair" }}
      />
    </div>
  );
}
