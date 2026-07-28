import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, Box, LaImage } from "../api";
import AnnotationScreen from "../components/AnnotationScreen";

type TaskLite = { id: number; classes?: string[] };

export default function GoldenEditor() {
  const { imageId } = useParams();
  const nav = useNavigate();
  const [images, setImages] = useState<LaImage[]>([]);
  const [idx, setIdx] = useState(0);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [taskClasses, setTaskClasses] = useState<string[]>([]);
  const [taskId, setTaskId] = useState<number | null>(null);

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
    if (!current) return;
    api<Box[]>(`/api/images/${current.id}/boxes`).then(setBoxes);
  }, [current?.id]);

  const reloadBoxes = () => {
    if (!current) return;
    api<Box[]>(`/api/images/${current.id}/boxes`).then(setBoxes);
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
      onIdxChange={setIdx}
      boxes={boxes}
      onReloadBoxes={reloadBoxes}
      onBoxesChange={(fn) => setBoxes(fn)}
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
