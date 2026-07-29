import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, Box, LaImage } from "../api";
import AnnotationScreen from "../components/AnnotationScreen";
import { BoxesCache, fetchImageBoxes, prefetchImageBoxes } from "../utils/boxesCache";
import { preloadImageId } from "../utils/imagePrefetch";

type TaskLite = { id: number; classes?: string[] };

export default function GoldenEditor() {
  const { imageId } = useParams();
  const nav = useNavigate();
  const [images, setImages] = useState<LaImage[]>([]);
  const [idx, setIdx] = useState(0);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [taskClasses, setTaskClasses] = useState<string[]>([]);
  const [taskId, setTaskId] = useState<number | null>(null);
  const boxesCacheRef = useRef<BoxesCache>(new Map());
  const navTokenRef = useRef(0);
  const idxRef = useRef(0);
  idxRef.current = idx;

  useEffect(() => {
    if (!imageId) return;
    api<LaImage>(`/api/images/${imageId}`).then(async (img) => {
      const tid = img.task_id;
      if (!tid) {
        setImages([img]);
        setIdx(0);
        return;
      }
      setTaskId(tid);
      try {
        const task = await api<TaskLite>(`/api/tasks/${tid}`);
        setTaskClasses(task.classes || []);
      } catch {
        /* ignore */
      }
      try {
        const pool = await api<LaImage[]>(`/api/tasks/${tid}/golden-pool`);
        setImages(pool.length ? pool : [img]);
        const i = pool.findIndex((g) => g.id === img.id);
        setIdx(i >= 0 ? i : 0);
      } catch {
        setImages([img]);
        setIdx(0);
      }
    });
  }, [imageId]);

  const current = images[idx];

  useEffect(() => {
    if (!images.length) return;
    for (const j of [idx - 1, idx, idx + 1]) {
      if (j < 0 || j >= images.length) continue;
      const im = images[j];
      prefetchImageBoxes(im.id, boxesCacheRef.current);
      void preloadImageId(im.id).catch(() => {});
    }
  }, [idx, images]);

  const syncToImageIndex = useCallback(
    async (next: number) => {
      if (next < 0 || next >= images.length) return;
      const im = images[next];
      if (!im) return;
      const token = ++navTokenRef.current;
      try {
        const [boxesData] = await Promise.all([
          fetchImageBoxes(im.id, boxesCacheRef.current),
          preloadImageId(im.id),
        ]);
        if (token !== navTokenRef.current) return;
        setBoxes(boxesData);
        setIdx(next);
      } catch {
        if (token !== navTokenRef.current) return;
        setIdx(next);
      }
    },
    [images],
  );

  useEffect(() => {
    if (!images.length) return;
    void syncToImageIndex(idxRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images.length]);

  const reloadBoxes = () => {
    if (!current) return;
    api<Box[]>(`/api/images/${current.id}/boxes`).then((b) => {
      boxesCacheRef.current.set(current.id, b);
      setBoxes(b);
    });
  };

  const tid = taskId ?? current?.task_id;
  if (!current || tid == null) {
    return (
      <div className="annotate-root">
        <div className="annotate-loading">Đang tải...</div>
      </div>
    );
  }

  return (
    <AnnotationScreen
      mode="golden"
      images={images}
      idx={idx}
      onIdxChange={(next) => {
        void syncToImageIndex(next);
      }}
      boxes={boxes}
      onReloadBoxes={reloadBoxes}
      onBoxesChange={(fn) => {
        setBoxes((prev) => {
          const next = fn(prev);
          const im = images[idxRef.current];
          if (im) boxesCacheRef.current.set(im.id, next);
          return next;
        });
      }}
      taskId={tid}
      taskClasses={taskClasses}
      onTaskClassesChange={setTaskClasses}
      canEdit
      onBack={() => nav(`/admin/tasks/${tid}?tab=golden`)}
      onImagesChange={(fn) => setImages(fn)}
      showGoldenToggle
    />
  );
}
