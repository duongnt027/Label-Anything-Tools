import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, apiDownloadPost, Job, LaImage, User } from "../api";
import { AssigneeCombobox } from "../components/AssigneeCombobox";
import { AssigneesModal } from "../components/AssigneesModal";
import { ExportOptions, ExportOptionsModal } from "../components/ExportOptionsModal";
import { ImportGoldenModal } from "../components/ImportGoldenModal";
import { ImportTaskModal } from "../components/ImportTaskModal";
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

function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

type ExportTarget =
  | { kind: "task" }
  | { kind: "selected" }
  | { kind: "job"; jobId: number; taskJobId: number }
  | { kind: "golden" };

export default function TaskDetailPage() {
  const { taskId } = useParams();
  const [search] = useSearchParams();
  const nav = useNavigate();
  const tabParam = search.get("tab");
  const [screenTab, setScreenTab] = useState<"golden" | "jobs">(
    tabParam === "golden" ? "golden" : "jobs",
  );

  useEffect(() => {
    if (tabParam === "golden" || tabParam === "jobs") setScreenTab(tabParam);
  }, [tabParam]);
  const [golden, setGolden] = useState<LaImage[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [assignees, setAssignees] = useState<User[]>([]);
  const [selectedJobIds, setSelectedJobIds] = useState<Set<number>>(new Set());
  const [selectedGoldenIds, setSelectedGoldenIds] = useState<Set<number>>(new Set());
  const [importGoldenOpen, setImportGoldenOpen] = useState(false);
  const [importTaskOpen, setImportTaskOpen] = useState(false);
  const [assigneesOpen, setAssigneesOpen] = useState(false);
  const [exportTarget, setExportTarget] = useState<ExportTarget | null>(null);
  const [pageSize, setPageSize] = useState(20);

  const loadGolden = () => api<LaImage[]>(`/api/tasks/${taskId}/golden-pool`).then(setGolden);
  const loadJobs = () => api<Job[]>(`/api/jobs/by-task/${taskId}?tab=all`).then(setJobs);
  const loadAssignees = () => api<User[]>(`/api/tasks/${taskId}/assignees`).then(setAssignees);

  useEffect(() => {
    loadGolden().catch(console.error);
    loadAssignees().catch(console.error);
    loadJobs().catch(console.error);
  }, [taskId]);

  useEffect(() => {
    setSelectedJobIds(new Set());
    setSelectedGoldenIds(new Set());
  }, [taskId]);

  const allSelected = jobs.length > 0 && jobs.every((j) => selectedJobIds.has(j.id));
  const someSelected = jobs.some((j) => selectedJobIds.has(j.id));
  const allGoldenSelected = golden.length > 0 && golden.every((g) => selectedGoldenIds.has(g.id));
  const someGoldenSelected = golden.some((g) => selectedGoldenIds.has(g.id));

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

  const toggleAllGolden = () => {
    if (allGoldenSelected) setSelectedGoldenIds(new Set());
    else setSelectedGoldenIds(new Set(golden.map((g) => g.id)));
  };

  const toggleGolden = (id: number) => {
    setSelectedGoldenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runExport = async (target: ExportTarget, opts: ExportOptions) => {
    const payload = {
      include_images: opts.includeImages,
      box_visibility: opts.boxVisibility,
    };

    if (target.kind === "golden") {
      const ids = [...selectedGoldenIds];
      if (!ids.length) throw new Error("Chọn ít nhất một ảnh");
      const { blob, filename } = await apiDownloadPost(`/api/tasks/${taskId}/golden-pool/export`, {
        ...payload,
        image_ids: ids,
      });
      downloadBlob(blob, filename ?? `task-${taskId}-golden-pool.zip`);
      return;
    }

    let filename = `task-${taskId}-export.zip`;
    const body: typeof payload & { job_ids?: number[] } = { ...payload };
    if (target.kind === "selected") {
      const ids = [...selectedJobIds];
      if (!ids.length) throw new Error("Chọn ít nhất một job");
      body.job_ids = ids;
      filename = `task-${taskId}-jobs-selected.zip`;
    } else if (target.kind === "job") {
      body.job_ids = [target.jobId];
      filename = `task-${taskId}-job-${target.taskJobId}.zip`;
    }
    const out = await apiDownloadPost(`/api/tasks/${taskId}/export`, body);
    downloadBlob(out.blob, out.filename ?? filename);
  };

  const deleteTask = async () => {
    if (!confirm("Xóa task và toàn bộ dữ liệu?")) return;
    await api(`/api/tasks/${taskId}`, { method: "DELETE" });
    nav("/admin");
  };

  const assignJob = async (jobId: number, assigneeId: number) => {
    if (!assigneeId) return;
    try {
      await api(`/api/jobs/${jobId}/assign`, {
        method: "POST",
        body: JSON.stringify({ assignee_id: assigneeId }),
      });
      await loadJobs();
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : "Assign thất bại");
    }
  };

  const unassignJob = async (jobId: number) => {
    try {
      await api(`/api/jobs/${jobId}/unassign`, { method: "POST" });
      await loadJobs();
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : "Unassign thất bại");
    }
  };

  const JOB_STATES = ["new", "in_progress", "need_review", "completed", "rejected"] as const;

  const changeJobState = async (jobId: number, state: string) => {
    try {
      await api(`/api/jobs/${jobId}/state`, {
        method: "PATCH",
        body: JSON.stringify({ state }),
      });
      await loadJobs();
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : "Đổi state thất bại");
    }
  };

  const deleteGolden = async (imageId: number, name: string) => {
    if (!confirm(`Xóa ảnh golden "${name}"?`)) return;
    try {
      await api(`/api/tasks/${taskId}/golden-pool/${imageId}`, { method: "DELETE" });
      setSelectedGoldenIds((prev) => {
        const next = new Set(prev);
        next.delete(imageId);
        return next;
      });
      await loadGolden();
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : "Xóa thất bại");
    }
  };

  const deleteSelectedGolden = async () => {
    const ids = [...selectedGoldenIds];
    if (ids.length === 0) return;
    if (
      !confirm(
        `Xóa ${ids.length} ảnh đã chọn khỏi golden pool? Hành động này không hoàn tác được.`,
      )
    ) {
      return;
    }
    try {
      await Promise.all(
        ids.map((imageId) =>
          api(`/api/tasks/${taskId}/golden-pool/${imageId}`, { method: "DELETE" }),
        ),
      );
      setSelectedGoldenIds(new Set());
      await loadGolden();
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : "Xóa ảnh golden thất bại");
      await loadGolden();
    }
  };

  const openJob = (j: Job) => {
    if (j.state === "need_review" && j.review_stage === 2) {
      nav(`/jobs/${j.id}/review-s2?view_as=reviewer&admin_view=s2`);
    } else if (j.state === "need_review") {
      nav(`/jobs/${j.id}?mode=review&view_as=reviewer&admin_view=s1`);
    } else {
      nav(`/jobs/${j.id}?view_as=annotator&admin_view=annotator`);
    }
  };

  const goldenEmpty = golden.length === 0;

  const exportTitle =
    exportTarget?.kind === "task"
      ? "Export task"
      : exportTarget?.kind === "selected"
        ? "Export đã chọn"
        : exportTarget?.kind === "job"
          ? `Export job #${exportTarget.taskJobId}`
          : exportTarget?.kind === "golden"
            ? "Export pool"
            : "Export";

  return (
    <div className="task-detail-page">
      <div className="task-detail-toolbar">
        <button type="button" className="task-action-btn task-action-back" onClick={() => nav("/admin")}>
          ← Task dashboard
        </button>
        <div className="task-detail-toolbar-right">
          <button type="button" className="task-action-btn task-action-import" onClick={() => setImportTaskOpen(true)}>
            Import
          </button>
          <button
            type="button"
            className="task-action-btn task-action-export"
            onClick={() => setExportTarget({ kind: "task" })}
          >
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
          onClick={() => {
            setScreenTab("golden");
            nav(`/admin/tasks/${taskId}?tab=golden`, { replace: true });
          }}
        >
          Golden pool
        </button>
        <button
          type="button"
          className={`task-screen-tab ${screenTab === "jobs" ? "active" : ""}`}
          onClick={() => {
            setScreenTab("jobs");
            nav(`/admin/tasks/${taskId}?tab=jobs`, { replace: true });
          }}
        >
          Jobs
        </button>
      </div>

      {screenTab === "golden" ? (
        <div className={`dashboard-panel ${goldenEmpty ? "dashboard-panel-fill" : ""}`}>
          {goldenEmpty ? (
            <div className="golden-empty-center">
              <button
                type="button"
                className="golden-import-cta"
                onClick={() => setImportGoldenOpen(true)}
              >
                <span className="golden-import-cta-plus" aria-hidden>
                  +
                </span>
                Import
              </button>
            </div>
          ) : (
            <>
              <div className="jobs-bulk-bar">
                <label className="jobs-bulk-check">
                  <input
                    type="checkbox"
                    className="jobs-tick"
                    checked={allGoldenSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someGoldenSelected && !allGoldenSelected;
                    }}
                    onChange={toggleAllGolden}
                  />
                  <span className="jobs-bulk-check-label">Chọn ảnh</span>
                </label>
                <div className="jobs-bulk-actions">
                  <button
                    type="button"
                    className="golden-import-cta golden-import-cta-sm"
                    onClick={() => setImportGoldenOpen(true)}
                  >
                    <span className="golden-import-cta-plus" aria-hidden>
                      +
                    </span>
                    Import
                  </button>
                  <button
                    type="button"
                    className="task-action-btn task-action-delete task-action-export-sm"
                    disabled={selectedGoldenIds.size === 0}
                    onClick={deleteSelectedGolden}
                  >
                    Xóa đã chọn ({selectedGoldenIds.size})
                  </button>
                  <button
                    type="button"
                    className="task-action-btn task-action-export task-action-export-sm"
                    disabled={selectedGoldenIds.size === 0}
                    onClick={() => setExportTarget({ kind: "golden" })}
                  >
                    Export pool ({selectedGoldenIds.size})
                  </button>
                </div>
              </div>
              <div className="jobs-table-wrap">
                <table className="jobs-table jobs-table-task golden-pool-table">
                  <thead>
                    <tr>
                      <th className="col-check" />
                      <th>Tên ảnh</th>
                      <th>Boxes</th>
                      <th>Classes</th>
                      <th className="col-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {golden.map((g) => {
                      const name = g.filename || `#${g.id}`;
                      return (
                        <tr key={g.id}>
                          <td className="col-check">
                            <input
                              type="checkbox"
                              className="jobs-tick"
                              checked={selectedGoldenIds.has(g.id)}
                              onChange={() => toggleGolden(g.id)}
                              aria-label={`Chọn ${name}`}
                            />
                          </td>
                          <td className="golden-name-cell" title={name}>
                            {name}
                          </td>
                          <td>{g.box_count ?? 0}</td>
                          <td>{g.class_count ?? 0}</td>
                          <td className="col-actions">
                            <button
                              type="button"
                              className="icon-btn-open"
                              title="Mở ảnh"
                              onClick={() => nav(`/golden/${g.id}`)}
                            >
                              <IconFolderOpen />
                            </button>
                            <button
                              type="button"
                              className="btn-x btn-x-lg"
                              title="Xóa ảnh"
                              onClick={() => deleteGolden(g.id, name)}
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className={`dashboard-panel ${jobs.length === 0 ? "dashboard-panel-fill" : ""}`}>
          {jobs.length === 0 ? (
            <div className="dashboard-empty">
              <p>Chưa có job.</p>
            </div>
          ) : (
            <>
              <div className="jobs-bulk-bar">
                <label className="jobs-bulk-check">
                  <input
                    type="checkbox"
                    className="jobs-tick"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected && !allSelected;
                    }}
                    onChange={toggleAllJobs}
                  />
                  <span className="jobs-bulk-check-label">Chọn job</span>
                </label>
                <div className="jobs-bulk-actions">
                  <label className="jobs-page-size">
                    <span>List view</span>
                    <select
                      value={pageSize}
                      onChange={(e) => setPageSize(Number(e.target.value))}
                      aria-label="Số job tối đa hiển thị"
                    >
                      <option value={10}>10</option>
                      <option value={20}>20</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    className="task-action-btn task-action-assignees"
                    onClick={() => setAssigneesOpen(true)}
                  >
                    Assignees
                  </button>
                  <button
                    type="button"
                    className="task-action-btn task-action-export task-action-export-sm"
                    disabled={selectedJobIds.size === 0}
                    onClick={() => setExportTarget({ kind: "selected" })}
                  >
                    Export đã chọn ({selectedJobIds.size})
                  </button>
                </div>
              </div>

              <div
                className="jobs-table-wrap jobs-table-scroll"
                style={{ maxHeight: `calc(${pageSize} * 2.75rem + 2.75rem)` }}
              >
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
                            className="jobs-tick"
                            checked={selectedJobIds.has(j.id)}
                            onChange={() => toggleJob(j.id)}
                            aria-label={`Chọn job ${j.task_job_id}`}
                          />
                        </td>
                        <td>#{j.task_job_id}</td>
                        <td>{formatDateTime(j.updated_at)}</td>
                        <td>{j.img_num}</td>
                        <td className="col-assignee">
                          <div className="assignee-cell">
                            {assignees.length === 0 && !j.assignee_username ? (
                              <span className="assignee-empty-hint">Thêm Assignees trước</span>
                            ) : (
                              <AssigneeCombobox
                                users={assignees}
                                value={j.assignee_username ?? ""}
                                onAssign={(id) => assignJob(j.id, id)}
                                onClear={j.assignee_username ? () => unassignJob(j.id) : undefined}
                              />
                            )}
                          </div>
                        </td>
                        <td>{j.locked_by_username ?? "—"}</td>
                        <td>
                          <select
                            className={`job-state-select is-picked state-${j.state}`}
                            value={j.state}
                            onChange={(e) => changeJobState(j.id, e.target.value)}
                            onFocus={(e) => e.currentTarget.classList.remove("is-picked")}
                            onBlur={(e) => e.currentTarget.classList.add("is-picked")}
                            aria-label={`State job #${j.task_job_id}`}
                          >
                            {JOB_STATES.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="col-actions">
                          <button type="button" className="icon-btn-open" title="Mở job" onClick={() => openJob(j)}>
                            <IconFolderOpen />
                          </button>
                          <button
                            type="button"
                            className="icon-btn-export"
                            title="Export job"
                            onClick={() =>
                              setExportTarget({ kind: "job", jobId: j.id, taskJobId: j.task_job_id })
                            }
                          >
                            <IconExport size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {importGoldenOpen && taskId && (
        <ImportGoldenModal
          taskId={taskId}
          onClose={() => setImportGoldenOpen(false)}
          onImported={() => loadGolden().catch(console.error)}
        />
      )}

      {importTaskOpen && taskId && (
        <ImportTaskModal
          taskId={taskId}
          onClose={() => setImportTaskOpen(false)}
          onImported={() => {
            loadJobs().catch(console.error);
            loadGolden().catch(console.error);
          }}
        />
      )}

      {exportTarget && (
        <ExportOptionsModal
          title={exportTitle}
          onClose={() => setExportTarget(null)}
          onConfirm={(opts) => runExport(exportTarget, opts)}
        />
      )}

      {assigneesOpen && taskId && (
        <AssigneesModal
          taskId={taskId}
          onClose={() => setAssigneesOpen(false)}
          onChanged={() => {
            loadAssignees().catch(console.error);
            loadJobs().catch(console.error);
          }}
        />
      )}
    </div>
  );
}
