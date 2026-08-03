import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, Box, Job, LaImage } from "../api";
import { useAuth } from "../auth";
import AdminViewSwitcher, { AdminJobView } from "../components/AdminViewSwitcher";
import AnnotationScreen from "../components/AnnotationScreen";
import { ResumeFrameModal } from "../components/ResumeFrameModal";
import ReviewStage1 from "./ReviewStage1";
import { unlockJobOnLeave } from "../utils/jobLock";
import { BoxesCache, prefetchJobImageBoxes, appendBoxToCache, invalidateBoxesCache, stripTrackFromCache } from "../utils/boxesCache";
import { preloadImageId } from "../utils/imagePrefetch";

function parseAdminView(raw: string | null): AdminJobView | null {
  if (raw === "annotator" || raw === "s1" || raw === "s2") return raw;
  return null;
}

function jobAdminQuery(
  userRole: string | undefined,
  viewAs: string | null,
  adminView: AdminJobView | null,
  screen: AdminJobView = "annotator",
): string {
  const qs = new URLSearchParams();
  if (viewAs) qs.set("view_as", viewAs);
  else if (userRole === "admin") qs.set("view_as", screen === "annotator" ? "annotator" : "reviewer");
  if (userRole === "admin") qs.set("admin_view", adminView ?? screen);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export default function JobWorkspace() {
  const { jobId } = useParams();
  const [search] = useSearchParams();
  const mode = search.get("mode");
  const viewAs = search.get("view_as");
  const adminView = parseAdminView(search.get("admin_view"));
  const nav = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [job, setJob] = useState<Job | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [images, setImages] = useState<LaImage[]>([]);
  const [idx, setIdx] = useState(0);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [taskClasses, setTaskClasses] = useState<string[]>([]);
  const boxesCacheRef = useRef<BoxesCache>(new Map());
  const navTokenRef = useRef(0);
  const idxRef = useRef(0);
  idxRef.current = idx;
  const viewImageTimerRef = useRef<number | null>(null);

  const scheduleViewImage = useCallback(
    (imageId: number) => {
      if (!jobId) return;
      if (viewImageTimerRef.current != null) window.clearTimeout(viewImageTimerRef.current);
      viewImageTimerRef.current = window.setTimeout(() => {
        viewImageTimerRef.current = null;
        void api<{ job: Job }>(`/api/jobs/${jobId}/view-image/${imageId}`, { method: "POST" }).then((r) =>
          setJob(r.job),
        );
      }, 450);
    },
    [jobId],
  );

  useEffect(
    () => () => {
      if (viewImageTimerRef.current != null) window.clearTimeout(viewImageTimerRef.current);
    },
    [],
  );

  /** Footprint from DB (view_image log); null = not loaded yet. */
  const [resumeOfferIndex, setResumeOfferIndex] = useState<number | null | undefined>(undefined);
  const [workspaceBootIndex, setWorkspaceBootIndex] = useState(0);
  const [resumeDecided, setResumeDecided] = useState(false);
  const bootSyncedRef = useRef(false);

  const current = images[idx];

  /** Which screen to show (admin_view wins over mode). */
  const screen: AdminJobView =
    adminView ?? (mode === "review" ? "s1" : "annotator");

  const showAnnotator = screen === "annotator";
  const showS1 = screen === "s1";
  const isAnnotatorWorkspace =
    showAnnotator && (user?.role === "annotator" || viewAs === "annotator" || user?.role === "admin");

  useEffect(() => {
    if (!jobId || authLoading) return;
    bootSyncedRef.current = false;
    setResumeDecided(false);
    setResumeOfferIndex(undefined);
    setIdx(0);
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
    api<{
      job: Job;
      can_edit: boolean;
      task_classes: string[];
      resume_order_index?: number | null;
    }>(`/api/jobs/${jobId}/open?${qs.toString()}`, { method: "POST" }).then((r) => {
      setJob(r.job);
      setCanEdit(r.can_edit);
      setTaskClasses(r.task_classes || []);
      const ri = r.resume_order_index;
      if (user?.role === "admin") {
        setResumeOfferIndex(null);
        setWorkspaceBootIndex(0);
        setResumeDecided(true);
      } else if (typeof ri === "number" && ri > 0) {
        setResumeOfferIndex(ri);
        setWorkspaceBootIndex(ri);
        setResumeDecided(false);
      } else {
        setResumeOfferIndex(null);
        setWorkspaceBootIndex(0);
        setResumeDecided(true);
      }
      // Auto Stage 2 for real reviewers (not admin forcing S1/annotator)
      if (showS1 && r.job.review_stage === 2 && adminView !== "s1" && adminView !== "annotator") {
        const s2q = user?.role === "admin" ? "?view_as=reviewer&admin_view=s2" : "";
        nav(`/jobs/${jobId}/review-s2${s2q}`, { replace: true });
      }
    });
    api<LaImage[]>(`/api/jobs/${jobId}/images`).then(setImages);
  }, [jobId, viewAs, nav, adminView, user?.role, screen, showAnnotator, showS1, authLoading]);

  useEffect(() => {
    if (!jobId) return;
    const onUnload = () => unlockJobOnLeave(jobId);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      unlockJobOnLeave(jobId);
    };
  }, [jobId]);

  const prefetchAround = useCallback(
    (center: number) => {
      if (!jobId || !images.length) return;
      for (const j of [center - 3, center - 2, center - 1, center, center + 1, center + 2, center + 3]) {
        if (j < 0 || j >= images.length) continue;
        const im = images[j];
        prefetchJobImageBoxes(jobId, im.id, boxesCacheRef.current);
        void preloadImageId(im.id).catch(() => {});
      }
    },
    [images, jobId],
  );

  useEffect(() => {
    if (!showAnnotator || !images.length || !jobId) return;
    prefetchAround(idx);
  }, [idx, images, jobId, showAnnotator, prefetchAround]);

  const syncToImageIndex = useCallback(
    async (next: number) => {
      if (next < 0 || next >= images.length) return;
      const im = images[next];
      if (!im || !jobId) return;
      const token = ++navTokenRef.current;

      const cachedBoxes = boxesCacheRef.current.get(im.id);
      if (cachedBoxes) {
        if (token !== navTokenRef.current) return;
        setBoxes(cachedBoxes);
        setIdx(next);
        void preloadImageId(im.id).catch(() => {});
        scheduleViewImage(im.id);
        return;
      }

      try {
        const [boxesData] = await Promise.all([
          api<Box[]>(`/api/jobs/${jobId}/images/${im.id}/boxes`).then((b) => {
            boxesCacheRef.current.set(im.id, b);
            return b;
          }),
          preloadImageId(im.id),
        ]);
        if (token !== navTokenRef.current) return;
        setBoxes(boxesData);
        setIdx(next);
        scheduleViewImage(im.id);
      } catch {
        if (token !== navTokenRef.current) return;
        setIdx(next);
      }
    },
    [images, jobId, scheduleViewImage],
  );

  useEffect(() => {
    if (!showAnnotator || !images.length || !jobId || !resumeDecided) return;
    if (bootSyncedRef.current) return;
    bootSyncedRef.current = true;
    void syncToImageIndex(workspaceBootIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, showAnnotator, images.length, resumeDecided, workspaceBootIndex]);

  const finishResumePrompt = useCallback((startAt: number) => {
    setWorkspaceBootIndex(startAt);
    setResumeOfferIndex(null);
    bootSyncedRef.current = false;
    setResumeDecided(true);
  }, []);

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
    api<Box[]>(`/api/jobs/${jobId}/images/${current.id}/boxes`).then((boxes) => {
      boxesCacheRef.current.set(current.id, boxes);
      setBoxes(boxes);
    });
  };

  const submitJob = async () => {
    if (!canEdit || !job) return;
    try {
      await api(
        `/api/jobs/${jobId}/submit${jobAdminQuery(user?.role, viewAs, adminView, "annotator")}`,
        { method: "POST" },
      );
      if (user?.role === "admin") {
        nav(`/jobs/${jobId}?mode=review&view_as=reviewer&admin_view=s1`, { replace: true });
        return;
      }
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

  const showResumeModal =
    resumeOfferIndex !== undefined &&
    resumeOfferIndex !== null &&
    resumeOfferIndex > 0 &&
    !resumeDecided &&
    images.length > 0;

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
        {showResumeModal && (
          <ResumeFrameModal
            frameNumber={resumeOfferIndex + 1}
            totalFrames={images.length}
            onContinue={() => finishResumePrompt(resumeOfferIndex)}
            onStartOver={() => finishResumePrompt(0)}
          />
        )}
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
          bootIndex={workspaceBootIndex}
          workspaceReady={resumeDecided}
          taskClasses={taskClasses}
        />
      </>
    );
  }

  return (
    <>
      {showResumeModal && (
        <ResumeFrameModal
          frameNumber={resumeOfferIndex + 1}
          totalFrames={images.length}
          onContinue={() => finishResumePrompt(resumeOfferIndex)}
          onStartOver={() => finishResumePrompt(0)}
        />
      )}
      <AnnotationScreen
        mode="job"
        jobId={jobId}
        onTrackBoxesInvalidate={(ids) => invalidateBoxesCache(boxesCacheRef.current, ids)}
        onTrackBoxCreated={(imageId, box) => appendBoxToCache(boxesCacheRef.current, imageId, box)}
        onTrackDeleted={(_trackId, tailIds) => {
          stripTrackFromCache(boxesCacheRef.current, _trackId, tailIds);
          invalidateBoxesCache(boxesCacheRef.current, tailIds);
          void Promise.all(
            tailIds.map((id) =>
              api<Box[]>(`/api/jobs/${jobId}/images/${id}/boxes`).then((b) => {
                boxesCacheRef.current.set(id, b);
                return b;
              }),
            ),
          ).then((lists) => {
            const cur = images[idxRef.current];
            if (cur && tailIds.includes(cur.id)) {
              const i = tailIds.indexOf(cur.id);
              if (i >= 0) setBoxes(lists[i] ?? []);
            }
          });
        }}
        images={images}
        idx={idx}
        onIdxChange={(next) => {
          void syncToImageIndex(next);
        }}
        onPrefetchIndex={prefetchAround}
        boxes={boxes}
        onReloadBoxes={reloadBoxes}
        onBoxesChange={(fn) => {
          setBoxes((prev) => {
            const next = fn(prev);
            const im = images[idxRef.current];
            if (im) boxesCacheRef.current.set(im.id, next);
            return next;
          });
        }}
        taskId={job.task_id}
        taskClasses={taskClasses}
        onTaskClassesChange={setTaskClasses}
        canEdit={canEdit}
        lockedByUsername={lockName}
        showSubmit={Boolean(isAnnotatorWorkspace && (user?.role === "annotator" || user?.role === "admin"))}
        submitEnabled={canEdit}
        onSubmit={submitJob}
        onBack={leaveBack}
        onImagesChange={(fn) => setImages(fn)}
        showGoldenToggle={user?.role === "admin"}
        showSlideshowToggle={user?.role === "admin" || user?.role === "reviewer"}
        headerAfterProgress={jobId ? <AdminViewSwitcher jobId={jobId} current="annotator" /> : null}
      />
    </>
  );
}
