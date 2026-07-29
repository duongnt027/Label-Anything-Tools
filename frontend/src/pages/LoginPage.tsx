import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { login } from "../api";
import { useAuth } from "../auth";
import AppLogo from "../components/AppLogo";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const nav = useNavigate();
  const { user, loading, setUserFromLogin } = useAuth();

  if (!loading && user) {
    return <Navigate to="/" replace />;
  }

  if (loading) {
    return <div className="center">Đang tải...</div>;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const loggedIn = await login(username, password);
      setUserFromLogin(loggedIn);
      nav("/");
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "Đăng nhập thất bại");
    }
  };

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-brand">
          <AppLogo size={56} className="login-logo" />
          <h1>Label Anything</h1>
        </div>
        <p className="subtitle">Sign in to start annotation workspace</p>
        <label>Username</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        <label style={{ marginTop: "0.75rem", display: "block" }}>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        {error && <p className="login-error">{error}</p>}
        <button type="submit" className="topbar-btn primary" style={{ width: "100%", marginTop: "1.25rem" }}>
          Login
        </button>
      </form>
    </div>
  );
}
