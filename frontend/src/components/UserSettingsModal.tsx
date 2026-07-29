import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { api, User } from "../api";
import { roleBadgeClass } from "../utils/roleBadge";

const ROLE_RANK: Record<string, number> = { admin: 3, reviewer: 2, annotator: 1 };

const IconPlus = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const IconTrash = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

export default function UserSettingsModal({ onClose }: { onClose: () => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [selected, setSelected] = useState<User | null>(null);
  const [form, setForm] = useState({
    username: "",
    password: "",
    role: "annotator",
    supervisor_username: "",
  });

  const load = () => api<User[]>("/api/users").then(setUsers);
  useEffect(() => {
    load().catch(console.error);
  }, []);

  useEffect(() => {
    if (selected) {
      setForm({
        username: selected.username,
        password: "",
        role: selected.role,
        supervisor_username: selected.supervisor_username || "",
      });
    } else {
      setForm({ username: "", password: "", role: "annotator", supervisor_username: "" });
    }
  }, [selected]);

  const save = async () => {
    const payload = {
      username: form.username,
      password: form.password || undefined,
      role: form.role,
      supervisor_username: form.supervisor_username.trim() || null,
    };
    if (selected) {
      await api(`/api/users/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    } else {
      await api("/api/users", {
        method: "POST",
        body: JSON.stringify({
          ...payload,
          password: form.password || "1",
        }),
      });
    }
    await load();
    setSelected(null);
  };

  const removeUser = async (u: User, e: MouseEvent) => {
    e.stopPropagation();
    if (isProtectedAdmin(u)) return;
    if (!confirm(`Xóa user ${u.username}?`)) return;
    try {
      await api(`/api/users/${u.id}`, { method: "DELETE" });
      if (selected?.id === u.id) setSelected(null);
      await load();
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : "Không xóa được user");
    }
  };

  const isProtectedAdmin = (u: User) => {
    const admins = users.filter((x) => x.role === "admin").sort((a, b) => a.id - b.id);
    return admins[0]?.id === u.id;
  };

  const supervisorOptions = useMemo(() => {
    const rank = ROLE_RANK[form.role] ?? 0;
    return users.filter((u) => {
      if (u.username === form.username) return false;
      const ur = ROLE_RANK[u.role] ?? 0;
      // Admin: only other admins. Others: strictly higher role.
      if (form.role === "admin") return u.role === "admin";
      return ur > rank;
    });
  }, [users, form.role, form.username]);

  useEffect(() => {
    if (!form.supervisor_username) return;
    if (!supervisorOptions.some((u) => u.username === form.supervisor_username)) {
      setForm((f) => ({ ...f, supervisor_username: "" }));
    }
  }, [form.role, form.username, form.supervisor_username, supervisorOptions]);

  return (
    <div className="modal-backdrop">
      <div className="admin-modal user-settings-modal">
        <div className="modal-head">
          <h3>Users</h3>
          <button type="button" className="icon-btn-ghost" onClick={onClose} title="Đóng">
            ✕
          </button>
        </div>

        <div className="user-settings-panels">
          <div className="settings-panel">
            <div className="settings-panel-head">
              <span className="settings-panel-title">Danh sách</span>
              <button
                type="button"
                className="icon-btn-add"
                onClick={() => setSelected(null)}
                title="Tạo user"
              >
                <IconPlus />
              </button>
            </div>
            <div className="user-block-list pretty-scroll">
              {users.map((u) => (
                <div
                  key={u.id}
                  role="button"
                  tabIndex={0}
                  className={`user-block ${selected?.id === u.id ? "active" : ""}`}
                  onClick={() => setSelected(u)}
                  onKeyDown={(e) => e.key === "Enter" && setSelected(u)}
                >
                  <div className="user-block-main">
                    <span className="user-block-name">{u.username}</span>
                    <span className={roleBadgeClass(u.role)}>{u.role.toUpperCase()}</span>
                  </div>
                  {!isProtectedAdmin(u) && (
                    <button
                      type="button"
                      className="icon-btn-danger-ghost"
                      title="Xóa"
                      onClick={(e) => removeUser(u, e)}
                    >
                      <IconTrash />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="settings-panel">
            <div className="settings-panel-title">{selected ? "Sửa user" : "User mới"}</div>
            <label className="field-label field-label-req">Username</label>
            <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            <label className="field-label">{selected ? "Password (trống = giữ)" : "Password"}</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <label className="field-label field-label-req">Role</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="admin">admin</option>
              <option value="reviewer">reviewer</option>
              <option value="annotator">annotator</option>
            </select>
            <label className="field-label">Supervisor</label>
            <select
              value={form.supervisor_username}
              onChange={(e) => setForm({ ...form, supervisor_username: e.target.value })}
            >
              <option value="">—</option>
              {supervisorOptions.map((u) => (
                <option key={u.id} value={u.username}>
                  {u.username} ({u.role})
                </option>
              ))}
            </select>
            <p className="field-hint">
              {form.role === "admin"
                ? "Admin chỉ có thể chọn admin khác làm supervisor, hoặc để trống."
                : "Supervisor phải có role cao hơn role hiện tại."}
            </p>
            <button type="button" className="topbar-btn primary" style={{ marginTop: "1rem", width: "100%" }} onClick={save}>
              ✓ Lưu
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
