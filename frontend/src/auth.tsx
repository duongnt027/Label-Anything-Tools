import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { api, logoutApi, refreshAccessToken, User } from "./api";

type AuthCtx = {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setUserFromLogin: (user: User) => void;
  logout: () => void;
};

const Ctx = createContext<AuthCtx | null>(null);

/** Renew JWT periodically and when user returns to the tab (keeps long annotation sessions). */
const REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const renewTimerRef = useRef<number | null>(null);

  const refresh = async () => {
    try {
      const me = await api<User>("/api/auth/me");
      setUser(me);
    } catch {
      if (await refreshAccessToken()) {
        try {
          const me = await api<User>("/api/auth/me");
          setUser(me);
          return;
        } catch {
          /* fall through */
        }
      }
      setUser(null);
    }
  };

  const renewToken = async () => {
    if (!user) return;
    await refreshAccessToken();
  };

  const setUserFromLogin = (u: User) => setUser(u);

  useEffect(() => {
    void (async () => {
      await refresh();
      await renewToken();
    })().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;

    const tick = () => {
      void renewToken();
    };
    renewTimerRef.current = window.setInterval(tick, REFRESH_INTERVAL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") void renewToken();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (renewTimerRef.current != null) window.clearInterval(renewTimerRef.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user?.id]);

  const logout = () => {
    void logoutApi().finally(() => {
      setUser(null);
      window.location.href = "/login";
    });
  };

  return (
    <Ctx.Provider value={{ user, loading, refresh, setUserFromLogin, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("AuthProvider missing");
  return v;
}
