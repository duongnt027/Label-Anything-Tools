import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { CreateTaskModal } from "../components/CreateTaskModal";
import { IconFolderOpen } from "../components/icons";

type Task = {
  id: number;
  name: string;
  job_num: number;
  img_num: number;
  completed_jobs: number;
  process: number;
  created_at: string;
};

function formatCreated(iso: string) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function AdminDashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const nav = useNavigate();

  const load = () => api<Task[]>("/api/tasks").then(setTasks);
  useEffect(() => {
    load().catch(console.error);
  }, []);

  return (
    <>
      <header className="topbar topbar-plain">
        <span className="topbar-title">Quản lý Task</span>
        <div className="topbar-spacer" />
        <button type="button" className="topbar-btn primary" onClick={() => setShowCreate(true)}>
          + Task
        </button>
      </header>
      <div className={`dashboard-panel ${tasks.length === 0 ? "dashboard-panel-fill" : ""}`}>
        {tasks.length === 0 ? (
          <div className="dashboard-empty">
            <p>Chưa có task.</p>
          </div>
        ) : (
          <div className="jobs-table-wrap">
            <table className="jobs-table jobs-table-static">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Ngày tạo</th>
                  <th>Jobs</th>
                  <th>Ảnh</th>
                  <th>Tiến độ</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td>{formatCreated(t.created_at)}</td>
                    <td>{t.job_num}</td>
                    <td>{t.img_num}</td>
                    <td>
                      <div className="progress-inline">
                        <span style={{ width: `${t.process}%` }} />
                      </div>
                      <small>
                        {t.process}% · {t.completed_jobs}/{t.job_num} completed
                      </small>
                    </td>
                    <td className="col-action">
                      <button
                        type="button"
                        className="icon-btn-open"
                        title="Mở task"
                        onClick={() => nav(`/admin/tasks/${t.id}`)}
                      >
                        <IconFolderOpen />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {showCreate && <CreateTaskModal onClose={() => setShowCreate(false)} onCreated={load} />}
    </>
  );
}
