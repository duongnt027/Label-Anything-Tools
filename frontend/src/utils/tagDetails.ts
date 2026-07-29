/** Per-tag detail notes stored as JSON in box.details */

export type TagDetailsMap = Record<string, string>;

export function parseTagDetails(raw?: string | null): TagDetailsMap {
  if (!raw?.trim()) return {};
  try {
    const o = JSON.parse(raw) as unknown;
    if (o && typeof o === "object" && !Array.isArray(o)) {
      const out: TagDetailsMap = {};
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (typeof v === "string") out[k] = v;
      }
      return out;
    }
  } catch {
    /* legacy plain text */
  }
  return { _note: raw };
}

export function serializeTagDetails(map: TagDetailsMap): string {
  const clean: TagDetailsMap = {};
  for (const [k, v] of Object.entries(map)) {
    if (k === "_note" || k === "_track" || k === "_track_from") continue;
    // Keep internal/trailing spaces while typing; only drop empty-after-trim keys.
    const t = v ?? "";
    if (t.trim()) clean[k] = t;
  }
  const track = (map._track || "").trim();
  const trackFrom = (map._track_from || "").trim();
  const trackMeta =
    track || trackFrom
      ? {
          ...(track ? { _track: track } : {}),
          ...(trackFrom ? { _track_from: trackFrom } : {}),
        }
      : {};
  if (Object.keys(clean).length === 0) {
    const legacy = (map._note || "").trim();
    if (Object.keys(trackMeta).length) {
      return JSON.stringify({ ...trackMeta, ...(legacy ? { _note: legacy } : {}) });
    }
    return legacy;
  }
  return JSON.stringify({ ...clean, ...trackMeta });
}

const GOLDEN_REF_PREFIX = "golden_pool_id:";

/** Split JSON/legacy details from golden_pool_id pipe suffix stored on images. */
export function splitImageDetailsMeta(raw?: string | null): { body: string; goldenSuffix: string } {
  if (!raw?.trim()) return { body: "", goldenSuffix: "" };
  const golden: string[] = [];
  const rest: string[] = [];
  for (const part of raw.split("|")) {
    const p = part.trim();
    if (p.startsWith(GOLDEN_REF_PREFIX)) golden.push(p);
    else rest.push(part);
  }
  return { body: rest.join("|").trim(), goldenSuffix: golden.join("|") };
}

export function mergeImageDetailsMeta(body: string, goldenSuffix: string): string {
  const b = (body || "").trim();
  const g = (goldenSuffix || "").trim();
  if (b && g) return `${b}|${g}`;
  return b || g || "";
}

/** Serialize tag map and preserve golden_pool_id suffix on image.details. */
export function commitImageTagDetails(raw: string | null | undefined, map: TagDetailsMap): string {
  const { goldenSuffix } = splitImageDetailsMeta(raw);
  return mergeImageDetailsMeta(serializeTagDetails(map), goldenSuffix);
}

/** Human-readable lines for annotator sidebar. */
export function formatTagDetailsDisplay(raw?: string | null): string {
  const map = parseTagDetails(raw);
  const entries = Object.entries(map).filter(
    ([k, v]) => k !== "_note" && k !== "_track" && k !== "_track_from" && v.trim(),
  );
  if (entries.length) {
    return entries.map(([k, v]) => `${k}: ${v}`).join("\n");
  }
  if (map._note?.trim()) return map._note.trim();
  return "";
}
