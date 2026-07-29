import { useEffect, useMemo, useState } from "react";
import { api, User } from "../api";
import { roleBadgeClass } from "../utils/roleBadge";

export function AssigneesModal({
  taskId,
  onClose,
  onChanged,
}: {
  taskId: string;
  onClose: () => void;
  /** Called when pool or job assignments change. */
  onChanged: () => void;
}) {
  const [candidates, setCandidates] = useState<User[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [candidateQuery, setCandidateQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const persistPool = async (ids: Set<number>) => {
    const list = await api<User[]>(`/api/tasks/${taskId}/assignees`, {
      method: "PUT",
      body: JSON.stringify({ user_ids: [...ids] }),
    });
    setSelectedIds(new Set(list.map((u) => u.id)));
    onChanged();
    return list;
  };

  useEffect(() => {
    Promise.all([
      api<User[]>("/api/users").then((u) =>
        u.filter((x) => x.role === "annotator" || x.role === "reviewer"),
      ),
      api<User[]>(`/api/tasks/${taskId}/assignees`),
    ])
      .then(([cands, pool]) => {
        setCandidates(cands);
        setSelectedIds(new Set(pool.map((u) => u.id)));
      })
      .catch(() => setErr("Không tải được danh sách assignees"));
  }, [taskId]);

  const selectedMembers = useMemo(
    () => candidates.filter((u) => selectedIds.has(u.id)),
    [candidates, selectedIds],
  );

  const filteredCandidates = useMemo(() => {
    const q = candidateQuery.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((u) => u.username.toLowerCase().includes(q));
  }, [candidates, candidateQuery]);

  const allSelected =
    filteredCandidates.length > 0 && filteredCandidates.every((u) => selectedIds.has(u.id));
  const someSelected = filteredCandidates.some((u) => selectedIds.has(u.id));

  const applyIds = async (next: Set<number>) => {
    setErr("");
    setBusy(true);
    const prev = selectedIds;
    setSelectedIds(next);
    try {
      await persistPool(next);
    } catch (ex) {
      setSelectedIds(prev);
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: number) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    void applyIds(next);
  };

  const toggleAll = () => {
    const next = new Set(selectedIds);
    if (allSelected) {
      for (const u of filteredCandidates) next.delete(u.id);
    } else {
      for (const u of filteredCandidates) next.add(u.id);
    }
    void applyIds(next);
  };

  const removeMember = (id: number) => {
    const next = new Set(selectedIds);
    next.delete(id);
    void applyIds(next);
  };

  const autoAssign = async () => {
    setErr("");
    if (!selectedIds.size) {
      setErr("Chưa có thành viên khả thi để tự assign — thêm vào Assignees trước");
      return;
    }
    setBusy(true);
    try {
      // Ensure pool is saved, then auto-assign from persisted pool only.
      await persistPool(selectedIds);
      const r = await api<{ assigned: number }>(`/api/jobs/by-task/${taskId}/auto-assign`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      onChanged();
      if (r.assigned === 0) {
        setErr("Không còn job chưa assign.");
      } else {
        onClose();
      }
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="admin-modal assignees-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Assignees</h3>
          <button type="button" className="icon-btn-ghost" onClick={onClose} title="Đóng">
            ✕
          </button>
        </div>

        <div className="assignees-section">
          <div className="assignees-section-label">Thành viên đã chọn</div>
          <div className="assignee-chips-panel pretty-scroll">
            {selectedMembers.length === 0 ? (
              <span className="assignee-chips-empty">
                Chưa có thành viên — tick ứng viên bên dưới để thêm vào assignees
              </span>
            ) : (
              selectedMembers.map((u) => (
                <span key={u.id} className="assignee-chip">
                  <span className="assignee-chip-name">{u.username}</span>
                  <span className={roleBadgeClass(u.role)}>{u.role === "reviewer" ? "R" : "A"}</span>
                  <button
                    type="button"
                    className="btn-x"
                    title="Xóa khỏi assignees (và bỏ gán các job)"
                    disabled={busy}
                    onClick={() => removeMember(u.id)}
                  >
                    ×
                  </button>
                </span>
              ))
            )}
          </div>
        </div>

        <div className="assignees-auto-row">
          <button
            type="button"
            className="topbar-btn primary"
            disabled={busy || selectedMembers.length === 0}
            onClick={autoAssign}
            title={
              selectedMembers.length === 0
                ? "Chưa có thành viên khả thi để tự assign"
                : "Chia đều job chưa assign"
            }
          >
            {busy ? "Đang xử lý…" : "Auto assign"}
          </button>
          <p className="field-hint assignees-auto-hint">
            {selectedMembers.length === 0
              ? "Chưa thêm thành viên — không có thành viên khả thi để tự assign."
              : "Chỉ gán job cho thành viên trong Assignees; chia đều (đã tính job đã assign)."}
          </p>
        </div>

        <div className="assignees-section">
          <div className="assignees-candidates-head">
            <span className="assignees-section-label">Ứng viên (annotator / reviewer)</span>
            <label className="jobs-bulk-check assignees-tick-all">
              <input
                type="checkbox"
                className="jobs-tick"
                checked={allSelected}
                disabled={busy || filteredCandidates.length === 0}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected && !allSelected;
                }}
                onChange={toggleAll}
              />
              <span className="jobs-bulk-check-label">Tick all</span>
            </label>
          </div>
          <input
            className="assignee-candidate-search"
            value={candidateQuery}
            onChange={(e) => setCandidateQuery(e.target.value)}
            placeholder="Tìm theo username…"
            disabled={busy}
          />
          <div className="assignee-candidate-list user-block-list pretty-scroll">
            {filteredCandidates.map((u) => (
              <div
                key={u.id}
                role="button"
                tabIndex={0}
                className={`user-block ${selectedIds.has(u.id) ? "active" : ""}`}
                onClick={() => !busy && toggle(u.id)}
                onKeyDown={(e) => e.key === "Enter" && !busy && toggle(u.id)}
              >
                <div className="user-block-main">
                  <span className="user-block-name">{u.username}</span>
                  <span className={roleBadgeClass(u.role)}>{u.role.toUpperCase()}</span>
                </div>
                <input
                  type="checkbox"
                  className="jobs-tick"
                  checked={selectedIds.has(u.id)}
                  disabled={busy}
                  onChange={() => toggle(u.id)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Chọn ${u.username}`}
                />
              </div>
            ))}
            {candidates.length === 0 && (
              <p className="field-hint" style={{ margin: 0 }}>
                Không có annotator/reviewer.
              </p>
            )}
            {candidates.length > 0 && filteredCandidates.length === 0 && (
              <p className="field-hint" style={{ margin: 0 }}>
                Không tìm thấy username khớp.
              </p>
            )}
          </div>
        </div>

        {err && <p className="form-error">{err}</p>}

        <div className="modal-actions-split">
          <button type="button" className="topbar-btn" onClick={onClose} disabled={busy}>
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
