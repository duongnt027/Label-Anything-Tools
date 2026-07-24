import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, Job } from "../api";
import { IconFolderOpen } from "../components/icons";

export default function ReviewerDashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const nav = useNavigate();

  useEffect(() => {
    api<Job[]>("/api/jobs/my").then(setJobs).catch(console.error);
  }, []);

  return (
    <>
      <header className="topbar topbar-plain">
        <span className="topbar-title">Jobs cần review</span>
      </header>
      <div className="dashboard-panel">
        <div className="jobs-table-wrap">
          <table className="jobs-table jobs-table-static">
            <thead>
                <tr>
                  <th>Job</th>
                  <th>Ảnh</th>
                  <th>Stage</th>
                  <th>Tiến độ</th>
                  <th>Action</th>
                </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td>#{j.id}</td>
                  <td>{j.img_num}</td>
                  <td>{j.review_stage ?? 1}</td>
                  <td>
                    <div className="progress-inline">
                      <span style={{ width: `${j.progress}%` }} />
                    </div>
                  </td>
                  <td className="col-action">
                    <button
                      type="button"
                      className="icon-btn-open"
                      title="Mở job"
                      onClick={() =>
                        nav(j.review_stage === 2 ? `/jobs/${j.id}/review-s2` : `/jobs/${j.id}?mode=review`)
                      }
                    >
                      <IconFolderOpen />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
