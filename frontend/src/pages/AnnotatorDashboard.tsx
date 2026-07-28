import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, Job } from "../api";
import { IconFolderOpen } from "../components/icons";

export default function AnnotatorDashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const nav = useNavigate();

  useEffect(() => {
    api<Job[]>("/api/jobs/my").then(setJobs).catch(console.error);
  }, []);

  return (
    <>
      <header className="topbar topbar-plain">
        <span className="topbar-title">Jobs được giao</span>
      </header>
      <div className={`dashboard-panel ${jobs.length === 0 ? "dashboard-panel-fill" : ""}`}>
        {jobs.length === 0 ? (
          <div className="dashboard-empty">
            <p>Chưa có job.</p>
          </div>
        ) : (
          <div className="jobs-table-wrap">
            <table className="jobs-table jobs-table-static">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Ảnh</th>
                  <th>Tiến độ</th>
                  <th>State</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td>#{j.task_job_id}</td>
                    <td>{j.img_num}</td>
                    <td>
                      <div className="progress-inline">
                        <span style={{ width: `${j.progress}%` }} />
                      </div>
                      <small style={{ color: "var(--text-muted)" }}>
                        {j.annotator_process}/{j.img_num}
                      </small>
                    </td>
                    <td>
                      <span className={`job-state state-${j.state}`}>{j.state}</span>
                    </td>
                    <td className="col-action">
                      <button type="button" className="icon-btn-open" title="Mở job" onClick={() => nav(`/jobs/${j.id}`)}>
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
    </>
  );
}
