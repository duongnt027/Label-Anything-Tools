import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

export type AdminJobView = "annotator" | "s1" | "s2";

type Props = {
  jobId: string;
  current: AdminJobView;
};

/** Compact view switcher for admin — sits in the topbar after progress. */
export default function AdminViewSwitcher({ jobId, current }: Props) {
  const { user } = useAuth();
  const nav = useNavigate();
  if (user?.role !== "admin") return null;

  const go = (v: AdminJobView) => {
    if (v === "annotator") {
      nav(`/jobs/${jobId}?view_as=annotator&admin_view=annotator`, { replace: true });
      return;
    }
    if (v === "s1") {
      nav(`/jobs/${jobId}?mode=review&view_as=reviewer&admin_view=s1`, { replace: true });
      return;
    }
    nav(`/jobs/${jobId}/review-s2?view_as=reviewer&admin_view=s2`, { replace: true });
  };

  return (
    <div className="admin-view-switch" aria-label="Chọn góc nhìn">
      <button
        type="button"
        className={`admin-view-switch-btn ${current === "annotator" ? "on" : ""}`}
        onClick={() => go("annotator")}
      >
        Annotator
      </button>
      <button
        type="button"
        className={`admin-view-switch-btn ${current === "s1" ? "on" : ""}`}
        onClick={() => go("s1")}
      >
        Reviewer S1
      </button>
      <button
        type="button"
        className={`admin-view-switch-btn ${current === "s2" ? "on" : ""}`}
        onClick={() => go("s2")}
      >
        Reviewer S2
      </button>
    </div>
  );
}
