const TOKEN_KEY = "la_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

/** Renew JWT before expiry (Bearer and/or HttpOnly cookie). Returns false if re-login needed. */
export async function refreshAccessToken(): Promise<boolean> {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  try {
    const res = await fetch("/api/auth/refresh", {
      method: "POST",
      headers,
      credentials: "same-origin",
    });
    if (res.status === 401) return false;
    if (!res.ok) return false;
    const data = (await res.json()) as { access_token?: string };
    if (data.access_token) {
      setToken(data.access_token);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function logoutApi(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  } catch {
    /* ignore */
  }
  clearToken();
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, { ...options, headers, credentials: options.credentials ?? "same-origin" });
  if (res.status === 401) {
    clearToken();
    const onLogin = window.location.pathname === "/login" || window.location.pathname.startsWith("/login");
    if (!onLogin) {
      window.location.href = "/login";
    }
    throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

/** POST export/download endpoints that return binary (ZIP). Never parses body as JSON on success. */
export async function apiDownloadPost(
  path: string,
  body: unknown,
): Promise<{ blob: Blob; filename?: string }> {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/zip, application/octet-stream, */*");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(path, { method: "POST", headers, body: JSON.stringify(body), credentials: "same-origin" });
  if (res.status === 401) {
    clearToken();
    const onLogin = window.location.pathname === "/login" || window.location.pathname.startsWith("/login");
    if (!onLogin) window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const text = await res.text();
    let msg = res.statusText;
    const trimmed = text.trimStart();
    if (trimmed.startsWith("{")) {
      try {
        const j = JSON.parse(trimmed) as { detail?: string };
        if (typeof j.detail === "string") msg = j.detail;
      } catch {
        /* ignore */
      }
    } else if (text) {
      msg = text.slice(0, 240);
    }
    throw new Error(msg);
  }

  const cd = res.headers.get("Content-Disposition") ?? "";
  const m = /filename=\"([^\"]+)\"/i.exec(cd);
  return { blob: await res.blob(), filename: m?.[1] };
}

/** POST (or GET) that returns a binary file (e.g. export ZIP). */
export async function apiBlob(path: string, options: RequestInit = {}): Promise<Blob> {
  const headers = new Headers(options.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/zip, application/octet-stream, */*");
  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, { ...options, headers, credentials: options.credentials ?? "same-origin" });
  if (res.status === 401) {
    clearToken();
    const onLogin = window.location.pathname === "/login" || window.location.pathname.startsWith("/login");
    if (!onLogin) window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const text = await res.text();
    let msg = res.statusText;
    const trimmed = text.trimStart();
    if (trimmed.startsWith("{")) {
      try {
        const j = JSON.parse(trimmed) as { detail?: string };
        if (typeof j.detail === "string") msg = j.detail;
      } catch {
        /* ignore */
      }
    } else if (text) {
      msg = text.slice(0, 240);
    }
    throw new Error(msg);
  }
  return res.blob();
}

export async function login(username: string, password: string): Promise<User> {
  const body = new URLSearchParams({ username, password });
  let res: Response;
  try {
    res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      credentials: "same-origin",
    });
  } catch {
    throw new Error("Không kết nối được server API. Hãy chạy docker compose hoặc uvicorn backend.");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = err.detail;
    const msg =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((d: { msg?: string }) => d.msg).join(", ")
          : "Đăng nhập thất bại";
    throw new Error(msg);
  }
  const data = (await res.json()) as { access_token: string; user: User };
  setToken(data.access_token);
  return data.user;
}

export type User = {
  id: number;
  username: string;
  role: "admin" | "annotator" | "reviewer";
  supervisor_username: string | null;
};

export type Job = {
  id: number;
  task_id: number;
  /** 1-based job number within the task (display ID). */
  task_job_id: number;
  state: string;
  img_num: number;
  annotator_process: number;
  review_s1_process: number;
  review_s2_process: number;
  review_stage: number | null;
  progress: number;
  locked_by_id: number | null;
  locked_by_username?: string | null;
  updated_at?: string;
  assignee_username?: string | null;
};

export type LaImage = {
  id: number;
  task_id?: number;
  job_id?: number | null;
  image_source: string;
  filename?: string;
  order_index: number | null;
  tag: string[];
  status: string;
  caption: string | null;
  details: string | null;
  is_golden?: boolean;
  box_count?: number;
  class_count?: number;
};

export type Box = {
  id: number;
  img_id?: number;
  class: string;
  box_points: string;
  segment_points: string;
  ocr_text: string;
  caption: string;
  details?: string;
  tag: string[];
  status: string;
};

export function imageUrl(id: number) {
  return `/api/files/${id}`;
}
