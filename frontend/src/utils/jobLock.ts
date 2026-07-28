import { getToken } from "../api";

/** Fire-and-forget unlock (also works on page unload via keepalive). */
export function unlockJobOnLeave(jobId: string | undefined) {
  if (!jobId) return;
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    fetch(`/api/jobs/${jobId}/unlock`, {
      method: "POST",
      headers,
      credentials: "same-origin",
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}
