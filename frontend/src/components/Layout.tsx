import { useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import UserSettingsModal from "./UserSettingsModal";
import AppLogo from "./AppLogo";
import { roleBadgeClass } from "../utils/roleBadge";

const IconDashboard = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

const IconSettings = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
  </svg>
);

const IconLogout = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

const IconPanelToggle = ({ collapsed }: { collapsed: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    {collapsed ? (
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
    ) : (
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 6l-6 6 6 6" />
    )}
  </svg>
);

function roleLabel(role: string) {
  return role.toUpperCase();
}

export default function Layout() {
  const { user, loading, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  const location = useLocation();
  const nav = useNavigate();

  const isAnnotate =
    /^\/jobs\/\d+/.test(location.pathname) || /^\/golden\/\d+/.test(location.pathname);
  const flushMain = isAnnotate;

  if (loading) return <div className="center">Đang tải...</div>;
  if (!user) return <Navigate to="/login" replace />;

  const dashPath =
    user.role === "admin" ? "/admin" : user.role === "reviewer" ? "/reviewer" : "/annotator";

  return (
    <div className="app-shell">
      <aside className={`sidebar ${collapsed ? "sidebar-collapsed" : ""}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand-row">
            <AppLogo size={collapsed ? 28 : 32} className="sidebar-logo-img" alt="" />
            {!collapsed && <span className="sidebar-brand">Label Anything</span>}
          </div>
          <button
            type="button"
            className="sidebar-icon-btn sidebar-toggle-btn"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Mở rộng sidebar" : "Thu gọn sidebar"}
            aria-label={collapsed ? "Mở rộng sidebar" : "Thu gọn sidebar"}
          >
            <IconPanelToggle collapsed={collapsed} />
          </button>
        </div>
        <div className={`sidebar-user ${collapsed ? "sidebar-user-collapsed" : ""}`}>
          {!collapsed && <span className="name">{user.username}</span>}
          <span className={roleBadgeClass(user.role)} title={roleLabel(user.role)}>
            {collapsed ? user.role.charAt(0).toUpperCase() : roleLabel(user.role)}
          </span>
        </div>
        <div className="sidebar-section">
          {!collapsed && <div className="sidebar-section-title">Menu</div>}
          <button
            type="button"
            className={`sidebar-nav-btn ${location.pathname === dashPath ? "active" : ""}`}
            onClick={() => nav(dashPath)}
            title="Dashboard"
          >
            <IconDashboard />
            {!collapsed && <span>Dashboard</span>}
          </button>
          {user.role === "admin" && (
            <button type="button" className="sidebar-nav-btn" onClick={() => setUsersOpen(true)} title="User Setting">
              <IconSettings />
              {!collapsed && <span>Users</span>}
            </button>
          )}
        </div>
        <div className="sidebar-footer">
          <button
            type="button"
            className="sidebar-nav-btn sidebar-nav-btn-danger"
            onClick={logout}
            title="Sign out"
          >
            <IconLogout />
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>
      <div className="workspace">
        <main className={`main ${flushMain ? "main-flush" : ""}`}>
          <Outlet />
        </main>
      </div>
      {usersOpen && <UserSettingsModal onClose={() => setUsersOpen(false)} />}
    </div>
  );
}
