import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, Box, imageUrl, Job } from "../api";

export default function ReviewStage2() {
  const { jobId } = useParams();
  const nav = useNavigate();
  const [, setJob] = useState<Job | null>(null);
  const [boxes, setBoxes] = useState<(Box & { image_source: string })[]>([]);

  const load = () => {
    if (!jobId) return;
    api<{ job: Job }>(`/api/jobs/${jobId}/open`, { method: "POST" }).then((r) => setJob(r.job));
    api<(Box & { image_source: string })[]>(`/api/jobs/${jobId}/stage2/boxes`).then(setBoxes);
  };

  useEffect(load, [jobId]);

  const byClass = boxes.reduce<Record<string, typeof boxes>>((acc, b) => {
    const k = b.class || "(no class)";
    (acc[k] ||= []).push(b);
    return acc;
  }, {});

  const patchBox = async (id: number, patch: object) => {
    await api(`/api/images/boxes/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    load();
  };

  const submit = async () => {
    await api(`/api/jobs/${jobId}/review/stage2/submit`, { method: "POST" });
    nav(`/jobs/${jobId}?mode=review`);
  };

  const finish = async (accept: boolean) => {
    await api(`/api/jobs/${jobId}/${accept ? "accept" : "reject"}`, { method: "POST" });
    nav("/reviewer");
  };

  const BOX_TAGS = ["Sai class", "Sai OCR", "Sai Caption", "Sai segment", "Sai box_points"];

  return (
    <div>
      <button type="button" onClick={() => nav("/reviewer")}>
        ← Dashboard
      </button>
      <h2>Review Stage 2 — Job #{jobId}</h2>
      {Object.entries(byClass).map(([cls, list]) => (
        <section key={cls} style={{ marginBottom: "1.5rem" }}>
          <h3>{cls}</h3>
          <div className="card-grid">
            {list.map((b) => (
              <div key={b.id} className="card">
                <img src={imageUrl(b.img_id ?? 0)} alt="" style={{ width: "100%", maxHeight: 120, objectFit: "contain" }} />
                <div>OCR: {b.ocr_text}</div>
                <div>Caption: {b.caption}</div>
                <div>
                  Tags:{" "}
                  {b.tag.map((t) => (
                    <span key={t} className="tag-chip">
                      {t}
                    </span>
                  ))}
                </div>
                <div style={{ marginTop: 8 }}>
                  {BOX_TAGS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      style={{ margin: 2 }}
                      onClick={() =>
                        patchBox(b.id, {
                          tag: b.tag.includes(t) ? b.tag.filter((x) => x !== t) : [...b.tag, t],
                        })
                      }
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button type="button" className="primary" onClick={() => patchBox(b.id, { status: "Accepted" })}>
                    Accept
                  </button>
                  <button type="button" onClick={() => patchBox(b.id, { status: "Rejected" })}>
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
      <button type="button" className="primary" onClick={submit}>
        Submit stage 2
      </button>
      <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
        <button type="button" className="primary" onClick={() => finish(true)}>
          Accept job
        </button>
        <button type="button" onClick={() => finish(false)}>
          Reject job
        </button>
      </div>
    </div>
  );
}
