import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, Job } from "../api";
import { IconFolderOpen } from "../components/icons";

function openPath(j: Job) {
  if (j.state === "need_review" && j.review_stage === 2) return `/jobs/${j.id}/review-s2`;
  if (j.state === "need_review") return `/jobs/${j.id}?mode=review`;
  // Chưa need_review: xem màn annotator (read-only, tool tắt)
  return `/jobs/${j.id}`;
}

export default function ReviewerDashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const nav = useNavigate();

  useEffect(() => {
    api<Job[]>("/api/jobs/my").then(setJobs).catch(console.error);
  }, []);

  return (
    <>
      <header className="topbar topbar-plain">
        <span className="topbar-title">Jobs của annotator quản lý</span>
      </header>
      <div className={`dashboard-panel ${jobs.length === 0 ? "dashboard-panel-fill" : ""}`}>
        {jobs.length === 0 ? (
          <div className="dashboard-empty">
            <p>Chưa có job.</p>
          </div>
        ) : (
          <div className="jobs-table-wrap pretty-scroll">
            <table className="jobs-table jobs-table-static">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Assignee</th>
                  <th>Ảnh</th>
                  <th>State</th>
                  <th>Stage</th>
                  <th>Tiến độ</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => {
                  const editable = j.state === "need_review";
                  return (
                    <tr key={j.id}>
                      <td>#{j.task_job_id}</td>
                      <td>{j.assignee_username || "—"}</td>
                      <td>{j.img_num}</td>
                      <td>
                        <span className={`job-state state-${j.state}`}>{j.state}</span>
                      </td>
                      <td>{j.state === "need_review" ? j.review_stage ?? 1 : "—"}</td>
                      <td>
                        <div className="progress-inline">
                          <span style={{ width: `${j.progress}%` }} />
                        </div>
                      </td>
                      <td className="col-action">
                        <button
                          type="button"
                          className="icon-btn-open"
                          title={editable ? "Mở review" : "Xem (chỉ đọc)"}
                          onClick={() => nav(openPath(j))}
                        >
                          <IconFolderOpen />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
