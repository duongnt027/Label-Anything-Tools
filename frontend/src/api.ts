const TOKEN_KEY = "la_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
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
  const res = await fetch(path, { ...options, headers });
  if (res.status === 401) {
    clearToken();
    const onLogin = window.location.pathname === "/login" || window.location.pathname.startsWith("/login");
    if (!onLogin) {
      window.location.href = "/login";
    }
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function login(username: string, password: string): Promise<User> {
  const body = new URLSearchParams({ username, password });
  let res: Response;
  try {
    res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
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
  image_source: string;
  filename?: string;
  order_index: number | null;
  tag: string[];
  status: string;
  caption: string | null;
  details: string | null;
  is_golden?: boolean;
};

export type Box = {
  id: number;
  img_id?: number;
  class: string;
  box_points: string;
  segment_points: string;
  ocr_text: string;
  caption: string;
  tag: string[];
  status: string;
};

export function imageUrl(id: number) {
  const t = getToken();
  return `/api/files/${id}?t=${t}`;
}
