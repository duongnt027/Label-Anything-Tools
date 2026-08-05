import { Fragment, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { IconChevronRight } from "./icons";

type TaskEventCount = { action: string; count: number };
type TaskUserStatistics = { user_id: number; username: string; events: TaskEventCount[] };
type TaskStatisticsSection = {
  key: string;
  label: string;
  description: string;
  users: TaskUserStatistics[];
};
type TaskQualityIssue = { kind: string; label: string; count: number };
type TaskUserJobActivity = {
  job_id: number;
  task_job_id: number;
  state: string;
  active_seconds: number;
  events: TaskEventCount[];
  issues: TaskQualityIssue[];
  submit_count: number;
  reject_count: number;
  is_assignee: boolean;
};
type TaskUserOverview = {
  user_id: number;
  username: string;
  active_seconds: number;
  issues: TaskQualityIssue[];
  submit_count: number;
  reject_count: number;
  assigned_jobs: number;
  jobs: TaskUserJobActivity[];
};
type TaskStatisticsOut = { sections: TaskStatisticsSection[]; users: TaskUserOverview[] };

const EVENT_COLORS = [
  "#6366f1",
  "#38bdf8",
  "#22c55e",
  "#f59e0b",
  "#f97316",
  "#ef4444",
  "#ec4899",
  "#a855f7",
  "#14b8a6",
  "#84cc16",
  "#06b6d4",
  "#eab308",
  "#64748b",
  "#f43f5e",
  "#8b5cf6",
];

function formatAction(action: string) {
  return action.replace(/_/g, " ");
}

function formatDuration(seconds: number) {
  if (seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return "<1m";
}

function buildActionColors(actions: string[]): Map<string, string> {
  const sorted = [...actions].sort((a, b) => a.localeCompare(b));
  const map = new Map<string, string>();
  sorted.forEach((action, i) => {
    map.set(action, EVENT_COLORS[i % EVENT_COLORS.length]);
  });
  return map;
}

function issueTotal(issues: TaskQualityIssue[]) {
  return issues.reduce((s, i) => s + i.count, 0);
}

function StatSegment({
  event,
  total,
  color,
  ownerLabel,
}: {
  event: TaskEventCount;
  total: number;
  color: string;
  ownerLabel?: string;
}) {
  const pct = total > 0 ? ((event.count / total) * 100).toFixed(1) : "0";
  const label = formatAction(event.action);

  return (
    <span
      className="task-stat-segment-wrap"
      style={{ flexGrow: event.count, flexBasis: 0 }}
      tabIndex={0}
      aria-label={`${label}: ${event.count} (${pct}%)`}
    >
      <span className="task-stat-segment" style={{ background: color }} />
      <span className="task-stat-tooltip" role="tooltip">
        {ownerLabel ? <span className="task-stat-tooltip-owner">{ownerLabel}</span> : null}
        <span className="task-stat-tooltip-head">
          <span className="task-stat-swatch" style={{ background: color }} aria-hidden />
          <span className="task-stat-tooltip-label">{label}</span>
        </span>
        <span className="task-stat-tooltip-metrics">
          <strong>{event.count.toLocaleString("vi-VN")}</strong>
          <span className="task-stat-tooltip-sep">·</span>
          <span>{pct}%</span>
        </span>
      </span>
    </span>
  );
}

function StatSegmentBar({
  events,
  colorOf,
  ownerLabel,
  small,
}: {
  events: TaskEventCount[];
  colorOf: Map<string, string>;
  ownerLabel?: string;
  small?: boolean;
}) {
  const total = events.reduce((s, e) => s + e.count, 0);
  if (total === 0) return null;

  return (
    <div
      className={`task-stat-bar ${small ? "task-stat-bar-sm" : ""}`}
      role="img"
      aria-label={
        ownerLabel
          ? `${ownerLabel}: ${events.map((e) => `${formatAction(e.action)} ${e.count}`).join(", ")}`
          : events.map((e) => `${formatAction(e.action)} ${e.count}`).join(", ")
      }
    >
      {events.map((e) => (
        <StatSegment
          key={e.action}
          event={e}
          total={total}
          color={colorOf.get(e.action) ?? "#64748b"}
          ownerLabel={ownerLabel}
        />
      ))}
    </div>
  );
}

function StatSectionBlock({
  section,
  colorOf,
}: {
  section: TaskStatisticsSection;
  colorOf: Map<string, string>;
}) {
  const sectionActions = useMemo(() => {
    const set = new Set<string>();
    section.users.forEach((u) => u.events.forEach((e) => set.add(e.action)));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [section]);

  if (section.users.length === 0) return null;

  return (
    <section className="task-stat-section" aria-labelledby={`stat-section-${section.key}`}>
      <header className="task-stat-section-head">
        <div>
          <h3 className="task-stat-section-title" id={`stat-section-${section.key}`}>
            {section.label}
          </h3>
          <p className="task-stat-section-desc">{section.description}</p>
        </div>
      </header>

      {sectionActions.length > 0 && (
        <div className="task-stat-legend" aria-label={`Chú thích ${section.label}`}>
          {sectionActions.map((action) => (
            <span key={action} className="task-stat-legend-item">
              <span
                className="task-stat-swatch"
                style={{ background: colorOf.get(action) }}
                aria-hidden
              />
              {formatAction(action)}
            </span>
          ))}
        </div>
      )}

      <div className="task-stat-users">
        {section.users.map((user) => {
          const total = user.events.reduce((s, e) => s + e.count, 0);
          return (
            <div key={user.user_id} className="task-stat-user-row">
              <div className="task-stat-user-head">
                <span className="task-stat-user-name">{user.username}</span>
                <span className="task-stat-user-total">{total} events</span>
              </div>
              <StatSegmentBar events={user.events} colorOf={colorOf} ownerLabel={user.username} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function UserActivitySection({
  users,
  colorOf,
}: {
  users: TaskUserOverview[];
  colorOf: Map<string, string>;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (users.length === 0) {
    return (
      <section className="task-stat-section">
        <header className="task-stat-section-head">
          <div>
            <h3 className="task-stat-section-title">Users</h3>
            <p className="task-stat-section-desc">
              Thời gian làm việc, lỗi review và hoạt động theo từng user
            </p>
          </div>
        </header>
        <p className="anno-muted task-stat-empty-inline">Chưa có hoạt động nào.</p>
      </section>
    );
  }

  return (
    <section className="task-stat-section" aria-labelledby="stat-section-users">
      <header className="task-stat-section-head">
        <div>
          <h3 className="task-stat-section-title" id="stat-section-users">
            Users
          </h3>
          <p className="task-stat-section-desc">
            Thời gian ước lượng từ log (gap {">"} 15 phút = session mới). Bấm user để xem chi tiết
            theo job.
          </p>
        </div>
      </header>

      <div className="task-stat-jobs-wrap">
        <table className="task-stat-jobs-table">
          <thead>
            <tr>
              <th />
              <th>User</th>
              <th>Thời gian</th>
              <th>Jobs gán</th>
              <th>Lỗi</th>
              <th>Submit</th>
              <th>Reject</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const isOpen = expanded === user.user_id;
              const errors = issueTotal(user.issues);
              return (
                <Fragment key={user.user_id}>
                  <tr
                    className={`task-stat-job-row ${isOpen ? "open" : ""} ${errors > 0 ? "has-issues" : ""}`}
                  >
                    <td>
                      <button
                        type="button"
                        className={`task-stat-job-expand ${isOpen ? "is-open" : ""}`}
                        aria-expanded={isOpen}
                        aria-label={`Chi tiết ${user.username}`}
                        onClick={() => setExpanded(isOpen ? null : user.user_id)}
                      >
                        <IconChevronRight size={15} />
                      </button>
                    </td>
                    <td className="task-stat-user-cell">{user.username}</td>
                    <td>{formatDuration(user.active_seconds)}</td>
                    <td>{user.assigned_jobs}</td>
                    <td>
                      {errors > 0 ? (
                        <span className="task-stat-issue-badge">{errors} lỗi</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{user.submit_count || "—"}</td>
                    <td>{user.reject_count || "—"}</td>
                  </tr>
                  {isOpen && (
                    <tr className="task-stat-job-detail-row">
                      <td colSpan={7}>
                        <div className="task-stat-job-detail">
                          {user.issues.length > 0 && (
                            <div className="task-stat-user-summary-issues">
                              <span className="task-stat-summary-label">Tổng lỗi:</span>
                              <div className="task-stat-issue-chips">
                                {user.issues.map((issue) => (
                                  <span
                                    key={`${issue.kind}-${issue.label}`}
                                    className="task-stat-issue-chip"
                                  >
                                    {issue.label}: {issue.count}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {user.jobs.length === 0 ? (
                            <p className="task-stat-job-detail-meta">Chưa có job nào.</p>
                          ) : (
                            user.jobs.map((job) => {
                              const total = job.events.reduce((s, e) => s + e.count, 0);
                              const jobErrors = issueTotal(job.issues);
                              return (
                                <div key={job.job_id} className="task-stat-job-user-block">
                                  <div className="task-stat-user-head">
                                    <span className="task-stat-user-name">
                                      Job #{job.task_job_id}
                                      {job.is_assignee ? (
                                        <span className="task-stat-assignee-tag">assignee</span>
                                      ) : null}
                                      <span className={`task-stat-state state-${job.state}`}>
                                        {job.state}
                                      </span>
                                    </span>
                                    <span className="task-stat-user-total">
                                      {formatDuration(job.active_seconds)}
                                      {total > 0 ? ` · ${total} events` : ""}
                                      {job.submit_count > 0 ? ` · submit ×${job.submit_count}` : ""}
                                      {job.reject_count > 0 ? ` · reject ×${job.reject_count}` : ""}
                                    </span>
                                  </div>
                                  {jobErrors > 0 && (
                                    <div className="task-stat-issue-chips">
                                      {job.issues.map((issue) => (
                                        <span
                                          key={`${job.job_id}-${issue.kind}-${issue.label}`}
                                          className="task-stat-issue-chip"
                                        >
                                          {issue.label}: {issue.count}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                  {job.events.length > 0 && (
                                    <StatSegmentBar
                                      events={job.events}
                                      colorOf={colorOf}
                                      ownerLabel={`Job #${job.task_job_id}`}
                                      small
                                    />
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function TaskStatisticsPanel({ taskId }: { taskId: string }) {
  const [data, setData] = useState<TaskStatisticsOut | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
    setData(null);
    void api<TaskStatisticsOut>(`/api/tasks/${taskId}/statistics`)
      .then(setData)
      .catch((ex) => setErr(ex instanceof Error ? ex.message : "Không tải được thống kê"));
  }, [taskId]);

  const allActions = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    data.sections.forEach((s) => s.users.forEach((u) => u.events.forEach((e) => set.add(e.action))));
    data.users.forEach((u) => u.jobs.forEach((j) => j.events.forEach((e) => set.add(e.action))));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [data]);

  const colorOf = useMemo(() => buildActionColors(allActions), [allActions]);

  if (err) {
    return (
      <div className="dashboard-panel dashboard-panel-fill">
        <p className="anno-muted task-stat-empty">{err}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="dashboard-panel dashboard-panel-fill">
        <p className="anno-muted task-stat-empty">Đang tải thống kê…</p>
      </div>
    );
  }

  const hasContent = data.sections.length > 0 || data.users.length > 0;
  if (!hasContent) {
    return (
      <div className="dashboard-panel dashboard-panel-fill">
        <p className="anno-muted task-stat-empty">Chưa có event nào cho task này.</p>
      </div>
    );
  }

  return (
    <div className="dashboard-panel task-stat-panel">
      <UserActivitySection users={data.users} colorOf={colorOf} />
      {data.sections.map((section) => (
        <StatSectionBlock key={section.key} section={section} colorOf={colorOf} />
      ))}
    </div>
  );
}
