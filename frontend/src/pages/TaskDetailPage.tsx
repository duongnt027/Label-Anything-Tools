import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, Job, LaImage, User } from "../api";
import { IconExport, IconFolderOpen } from "../components/icons";

function formatDateTime(iso: string | undefined) {
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

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

const JOB_STAGE_TABS: [string, string][] = [
  ["annotator", "Annotator"],
  ["review_s1", "Reviewer S1"],
  ["review_s2", "Reviewer S2"],
];

export default function TaskDetailPage() {
  const { taskId } = useParams();
  const nav = useNavigate();
  const [screenTab, setScreenTab] = useState<"golden" | "jobs">("jobs");
  const [golden, setGolden] = useState<LaImage[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [annotators, setAnnotators] = useState<User[]>([]);
  const [jobTab, setJobTab] = useState("annotator");
  const [assignDraft, setAssignDraft] = useState<Record<number, number>>({});
  const [selectedJobIds, setSelectedJobIds] = useState<Set<number>>(new Set());

  const loadJobs = () => api<Job[]>(`/api/jobs/by-task/${taskId}?tab=${jobTab}`).then(setJobs);

  useEffect(() => {
    api<LaImage[]>(`/api/tasks/${taskId}/golden-pool`).then(setGolden);
    api<User[]>("/api/users")
      .then((u) => setAnnotators(u.filter((x) => x.role === "annotator")))
      .catch(() => {});
  }, [taskId]);

  useEffect(() => {
    loadJobs().catch(console.error);
  }, [taskId, jobTab]);

  useEffect(() => {
    setSelectedJobIds(new Set());
  }, [jobTab, taskId]);

  const allSelected = jobs.length > 0 && jobs.every((j) => selectedJobIds.has(j.id));
  const someSelected = jobs.some((j) => selectedJobIds.has(j.id));

  const toggleAllJobs = () => {
    if (allSelected) setSelectedJobIds(new Set());
    else setSelectedJobIds(new Set(jobs.map((j) => j.id)));
  };

  const toggleJob = (id: number) => {
    setSelectedJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exportWithJobIds = async (jobIds: number[] | null, filename: string) => {
    const body: { include_rejected: boolean; job_ids?: number[] } = { include_rejected: true };
    if (jobIds && jobIds.length) body.job_ids = jobIds;
    const data = await api(`/api/tasks/${taskId}/export`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    downloadJson(data, filename);
  };

  const exportWholeTask = () => exportWithJobIds(null, `task-${taskId}-export.json`);

  const exportSelectedJobs = () => {
    const ids = [...selectedJobIds];
    if (!ids.length) {
      alert("Chọn ít nhất một job");
      return;
    }
    exportWithJobIds(ids, `task-${taskId}-jobs-${ids.join("-")}.json`);
  };

  const exportOneJob = (jobId: number) => {
    exportWithJobIds([jobId], `task-${taskId}-job-${jobId}.json`);
  };

  const importJson = async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    await fetch(`/api/tasks/${taskId}/import`, {
      method: "POST",
      headers: { Authorization: `Bearer ${localStorage.getItem("la_token")}` },
      body: fd,
    });
    alert("Import xong");
    loadJobs();
  };

  const deleteTask = async () => {
    if (!confirm("Xóa task và toàn bộ dữ liệu?")) return;
    await api(`/api/tasks/${taskId}`, { method: "DELETE" });
    nav("/admin");
  };

  const assignJob = async (jobId: number) => {
    const assigneeId = assignDraft[jobId];
    if (!assigneeId) return;
    await api(`/api/jobs/${jobId}/assign`, {
      method: "POST",
      body: JSON.stringify({ assignee_id: assigneeId }),
    });
    await loadJobs();
  };

  const openJob = (j: Job) => {
    if (jobTab === "review_s2") nav(`/jobs/${j.id}/review-s2`);
    else if (jobTab === "review_s1") nav(`/jobs/${j.id}?mode=review&view_as=reviewer`);
    else nav(`/jobs/${j.id}?view_as=annotator`);
  };

  const goldenEmpty = golden.length === 0;

  return (
    <div className="task-detail-page">
      <div className="task-detail-toolbar">
        <button type="button" className="task-action-btn task-action-back" onClick={() => nav("/admin")}>
          ← Task dashboard
        </button>
        <div className="task-detail-toolbar-right">
          <button
            type="button"
            className="task-action-btn task-action-import"
            onClick={() => document.getElementById("task-import-file")?.click()}
          >
            Import
          </button>
          <input
            id="task-import-file"
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])}
          />
          <button type="button" className="task-action-btn task-action-export" onClick={exportWholeTask}>
            Export
          </button>
          <button type="button" className="task-action-btn task-action-delete" onClick={deleteTask}>
            Delete task
          </button>
        </div>
      </div>

      <div className="task-screen-tabs">
        <button
          type="button"
          className={`task-screen-tab ${screenTab === "golden" ? "active" : ""}`}
          onClick={() => setScreenTab("golden")}
        >
          Golden pool
        </button>
        <button
          type="button"
          className={`task-screen-tab ${screenTab === "jobs" ? "active" : ""}`}
          onClick={() => setScreenTab("jobs")}
        >
          Jobs
        </button>
      </div>

      {screenTab === "golden" ? (
        <div className="dashboard-panel">
          {goldenEmpty ? (
            <p className="task-empty-hint">Chưa có ảnh golden trong pool.</p>
          ) : (
            <div className="golden-pool-grid">
              {golden.map((g) => (
                <button key={g.id} type="button" className="golden-pool-item" onClick={() => nav(`/golden/${g.id}`)}>
                  {g.filename || `#${g.id}`}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="dashboard-panel">
          <div className="job-stage-tabs">
            {JOB_STAGE_TABS.map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={`job-stage-tab ${jobTab === k ? "active" : ""}`}
                onClick={() => setJobTab(k)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="jobs-bulk-bar">
            <label className="jobs-bulk-check">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected && !allSelected;
                }}
                onChange={toggleAllJobs}
              />
              <span>Chọn job</span>
            </label>
            <button
              type="button"
              className="task-action-btn task-action-export task-action-export-sm"
              disabled={selectedJobIds.size === 0}
              onClick={exportSelectedJobs}
            >
              Export đã chọn ({selectedJobIds.size})
            </button>
          </div>

          <div className="jobs-table-wrap">
            <table className="jobs-table jobs-table-task">
              <thead>
                <tr>
                  <th className="col-check" />
                  <th>ID</th>
                  <th>Cập nhật</th>
                  <th>Ảnh</th>
                  <th>Assignee</th>
                  <th>Lock by</th>
                  <th>State</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td className="col-check">
                      <input
                        type="checkbox"
                        checked={selectedJobIds.has(j.id)}
                        onChange={() => toggleJob(j.id)}
                        aria-label={`Chọn job ${j.id}`}
                      />
                    </td>
                    <td>#{j.id}</td>
                    <td>{formatDateTime(j.updated_at)}</td>
                    <td>{j.img_num}</td>
                    <td className="col-assignee">
                      {j.assignee_username ? (
                        j.assignee_username
                      ) : jobTab === "annotator" ? (
                        <div className="assign-inline">
                          <select
                            value={assignDraft[j.id] ?? ""}
                            onChange={(e) =>
                              setAssignDraft((d) => ({ ...d, [j.id]: e.target.value ? +e.target.value : 0 }))
                            }
                          >
                            <option value="">—</option>
                            {annotators.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.username}
                              </option>
                            ))}
                          </select>
                          <button type="button" className="assign-go" onClick={() => assignJob(j.id)}>
                            Assign
                          </button>
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{j.locked_by_username ?? "—"}</td>
                    <td>
                      <span className={`job-state state-${j.state}`}>{j.state}</span>
                    </td>
                    <td className="col-actions">
                      <button type="button" className="icon-btn-open" title="Mở job" onClick={() => openJob(j)}>
                        <IconFolderOpen />
                      </button>
                      <button
                        type="button"
                        className="icon-btn-export"
                        title="Export job"
                        onClick={() => exportOneJob(j.id)}
                      >
                        <IconExport size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {jobs.length === 0 && <p className="task-empty-hint">Không có job ở tab này.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
