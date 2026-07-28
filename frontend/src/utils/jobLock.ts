import { getToken } from "../api";

/** Fire-and-forget unlock (also works on page unload via keepalive). */
export function unlockJobOnLeave(jobId: string | undefined) {
  if (!jobId) return;
  const token = getToken();
  if (!token) return;
  try {
    fetch(`/api/jobs/${jobId}/unlock`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}
