import { useEffect, useRef, useState } from "react";
import { api } from "../api";

export type TaskDetailInfo = {
  id: number;
  name: string;
  job_num: number;
  img_num: number;
  completed_jobs: number;
  process: number;
  created_at: string;
};

type Props = {
  task: TaskDetailInfo;
  onRenamed: (name: string) => void;
};

function formatCreated(iso: string) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export function TaskDetailHero({ task, onRenamed }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.name);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(task.name);
  }, [task.name]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const cancelEdit = () => {
    setDraft(task.name);
    setEditing(false);
  };

  const saveName = async () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      cancelEdit();
      return;
    }
    if (trimmed === task.name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const updated = await api<TaskDetailInfo>(`/api/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: trimmed }),
      });
      onRenamed(updated.name);
      setEditing(false);
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : "Đổi tên thất bại");
      setDraft(task.name);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="task-detail-hero" aria-label="Thông tin task">
      <div className="task-detail-hero-top">
        <span className="task-detail-id">Task #{task.id}</span>
        <span className="task-detail-created">Tạo {formatCreated(task.created_at)}</span>
      </div>

      <div className="task-detail-name-row">
        {editing ? (
          <div className="task-detail-name-edit">
            <input
              ref={inputRef}
              className="task-detail-name-input"
              value={draft}
              disabled={saving}
              maxLength={255}
              aria-label="Tên task"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveName();
                if (e.key === "Escape") cancelEdit();
              }}
              onBlur={() => void saveName()}
            />
            <button
              type="button"
              className="task-detail-name-btn task-detail-name-save"
              disabled={saving}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void saveName()}
            >
              {saving ? "…" : "Lưu"}
            </button>
            <button
              type="button"
              className="task-detail-name-btn task-detail-name-cancel"
              disabled={saving}
              onMouseDown={(e) => e.preventDefault()}
              onClick={cancelEdit}
            >
              Hủy
            </button>
          </div>
        ) : (
          <>
            <h1 className="task-detail-name" title={task.name}>
              {task.name}
            </h1>
            <button
              type="button"
              className="task-detail-name-edit-btn"
              title="Đổi tên task"
              aria-label="Đổi tên task"
              onClick={() => setEditing(true)}
            >
              ✎
            </button>
          </>
        )}
      </div>

      <div className="task-detail-stats">
        <span className="task-detail-stat">
          <strong>{task.job_num}</strong> jobs
        </span>
        <span className="task-detail-stat">
          <strong>{task.img_num}</strong> ảnh
        </span>
        <span className="task-detail-stat">
          <strong>{task.completed_jobs}</strong> hoàn thành
        </span>
        <span className="task-detail-stat task-detail-stat-progress">
          <span className="task-detail-progress-bar" aria-hidden>
            <span style={{ width: `${task.process}%` }} />
          </span>
          <strong>{task.process}%</strong>
        </span>
      </div>
    </section>
  );
}
