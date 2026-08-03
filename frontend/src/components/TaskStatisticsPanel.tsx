import { useEffect, useMemo, useState } from "react";
import { api } from "../api";

type TaskEventCount = { action: string; count: number };
type TaskUserStatistics = { user_id: number; username: string; events: TaskEventCount[] };
type TaskStatisticsSection = {
  key: string;
  label: string;
  description: string;
  users: TaskUserStatistics[];
};
type TaskStatisticsOut = { sections: TaskStatisticsSection[] };

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

function buildActionColors(actions: string[]): Map<string, string> {
  const sorted = [...actions].sort((a, b) => a.localeCompare(b));
  const map = new Map<string, string>();
  sorted.forEach((action, i) => {
    map.set(action, EVENT_COLORS[i % EVENT_COLORS.length]);
  });
  return map;
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
              <div
                className="task-stat-bar"
                role="img"
                aria-label={`${user.username}: ${user.events.map((e) => `${formatAction(e.action)} ${e.count}`).join(", ")}`}
              >
                {user.events.map((e) => (
                  <span
                    key={e.action}
                    className="task-stat-segment"
                    style={{
                      flexGrow: e.count,
                      flexBasis: 0,
                      background: colorOf.get(e.action),
                    }}
                    title={`${formatAction(e.action)}: ${e.count}`}
                  />
                ))}
              </div>
            </div>
          );
        })}
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

  if (data.sections.length === 0) {
    return (
      <div className="dashboard-panel dashboard-panel-fill">
        <p className="anno-muted task-stat-empty">Chưa có event nào cho task này.</p>
      </div>
    );
  }

  return (
    <div className="dashboard-panel task-stat-panel">
      {data.sections.map((section) => (
        <StatSectionBlock key={section.key} section={section} colorOf={colorOf} />
      ))}
    </div>
  );
}
