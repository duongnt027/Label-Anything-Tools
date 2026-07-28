import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, Box, Job, LaImage } from "../api";
import { useAuth } from "../auth";
import AdminViewSwitcher, { AdminJobView } from "../components/AdminViewSwitcher";
import AnnotationScreen from "../components/AnnotationScreen";
import ReviewStage1 from "./ReviewStage1";
import { unlockJobOnLeave } from "../utils/jobLock";

function parseAdminView(raw: string | null): AdminJobView | null {
  if (raw === "annotator" || raw === "s1" || raw === "s2") return raw;
  return null;
}

export default function JobWorkspace() {
  const { jobId } = useParams();
  const [search] = useSearchParams();
  const mode = search.get("mode");
  const viewAs = search.get("view_as");
  const adminView = parseAdminView(search.get("admin_view"));
  const nav = useNavigate();
  const { user } = useAuth();
  const [job, setJob] = useState<Job | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [images, setImages] = useState<LaImage[]>([]);
  const [idx, setIdx] = useState(0);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [taskClasses, setTaskClasses] = useState<string[]>([]);

  const current = images[idx];

  /** Which screen to show (admin_view wins over mode). */
  const screen: AdminJobView =
    adminView ?? (mode === "review" ? "s1" : "annotator");

  const showAnnotator = screen === "annotator";
  const showS1 = screen === "s1";
  const isAnnotatorWorkspace =
    showAnnotator && (user?.role === "annotator" || viewAs === "annotator" || user?.role === "admin");

  useEffect(() => {
    if (!jobId) return;
    if (screen === "s2" || adminView === "s2") {
      nav(`/jobs/${jobId}/review-s2?view_as=reviewer&admin_view=s2`, { replace: true });
      return;
    }
    const qs = new URLSearchParams();
    if (viewAs) qs.set("view_as", viewAs);
    else if (user?.role === "admin" && showAnnotator) qs.set("view_as", "annotator");
    else if (user?.role === "admin" && showS1) qs.set("view_as", "reviewer");
    if (user?.role === "admin") {
      if (adminView) qs.set("admin_view", adminView);
      else if (showAnnotator) qs.set("admin_view", "annotator");
      else if (showS1) qs.set("admin_view", "s1");
    }
    api<{ job: Job; can_edit: boolean; task_classes: string[] }>(
      `/api/jobs/${jobId}/open?${qs.toString()}`,
      { method: "POST" },
    ).then((r) => {
      setJob(r.job);
      setCanEdit(r.can_edit);
      setTaskClasses(r.task_classes || []);
      // Auto Stage 2 for real reviewers (not admin forcing S1/annotator)
      if (showS1 && r.job.review_stage === 2 && adminView !== "s1" && adminView !== "annotator") {
        const s2q = user?.role === "admin" ? "?view_as=reviewer&admin_view=s2" : "";
        nav(`/jobs/${jobId}/review-s2${s2q}`, { replace: true });
      }
    });
    api<LaImage[]>(`/api/jobs/${jobId}/images`).then(setImages);
  }, [jobId, viewAs, nav, adminView, user?.role, screen, showAnnotator, showS1]);

  useEffect(() => {
    if (!jobId) return;
    const onUnload = () => unlockJobOnLeave(jobId);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      unlockJobOnLeave(jobId);
    };
  }, [jobId]);

  useEffect(() => {
    if (!showAnnotator || !current || !jobId) return;
    api<Box[]>(`/api/jobs/${jobId}/images/${current.id}/boxes`).then(setBoxes);
    api<{ job: Job }>(`/api/jobs/${jobId}/view-image/${current.id}`, { method: "POST" }).then((r) =>
      setJob(r.job),
    );
  }, [current?.id, jobId, showAnnotator]);

  const leaveBack = () => {
    unlockJobOnLeave(jobId);
    if (user?.role === "admin" && job?.task_id) {
      nav(`/admin/tasks/${job.task_id}?tab=jobs`);
      return;
    }
    nav(user?.role === "reviewer" ? "/reviewer" : "/annotator");
  };

  const reloadBoxes = () => {
    if (!current || !jobId) return;
    api<Box[]>(`/api/jobs/${jobId}/images/${current.id}/boxes`).then(setBoxes);
  };

  const submitJob = async () => {
    if (!canEdit || !job) return;
    try {
      await api(`/api/jobs/${jobId}/submit`, { method: "POST" });
      unlockJobOnLeave(jobId);
      nav("/annotator");
    } catch (ex) {
      alert(ex instanceof Error ? ex.message : "Submit thất bại");
    }
  };

  const continueS1 = useCallback(async () => {
    await api(`/api/jobs/${jobId}/review/stage1/continue`, { method: "POST" });
    const s2q = user?.role === "admin" ? "?view_as=reviewer&admin_view=s2" : "";
    nav(`/jobs/${jobId}/review-s2${s2q}`);
  }, [jobId, nav, user?.role]);

  const onJobChange = useCallback((j: Job) => setJob(j), []);

  if (!job) {
    return (
      <div className="annotate-root">
        <div className="annotate-loading">Đang tải job...</div>
      </div>
    );
  }

  const lockName = job.locked_by_username || (canEdit ? user?.username : null);

  if (showS1) {
    if (job.review_stage === 2 && adminView !== "s1") {
      return (
        <div className="annotate-root">
          <div className="annotate-loading">Chuyển Stage 2...</div>
        </div>
      );
    }
    return (
      <>
        <ReviewStage1
          job={job}
          jobId={jobId!}
          images={images}
          canEdit={canEdit}
          lockedByUsername={lockName}
          onBack={leaveBack}
          onImagesChange={(fn) => setImages(fn)}
          onJobChange={onJobChange}
          onContinueS2={continueS1}
          headerAfterProgress={jobId ? <AdminViewSwitcher jobId={jobId} current="s1" /> : null}
        />
      </>
    );
  }

  return (
    <>
      <AnnotationScreen
        mode="job"
        images={images}
        idx={idx}
        onIdxChange={setIdx}
        boxes={boxes}
        onReloadBoxes={reloadBoxes}
        onBoxesChange={(fn) => setBoxes(fn)}
        taskId={job.task_id}
        taskClasses={taskClasses}
        onTaskClassesChange={setTaskClasses}
        canEdit={canEdit}
        lockedByUsername={lockName}
        showSubmit={Boolean(isAnnotatorWorkspace && user?.role === "annotator")}
        submitEnabled={canEdit}
        onSubmit={submitJob}
        onBack={leaveBack}
        onImagesChange={(fn) => setImages(fn)}
        showGoldenToggle={user?.role === "admin"}
        headerAfterProgress={jobId ? <AdminViewSwitcher jobId={jobId} current="annotator" /> : null}
      />
    </>
  );
}
