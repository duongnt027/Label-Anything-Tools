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
    if (k === "_note") continue;
    // Keep internal/trailing spaces while typing; only drop empty-after-trim keys.
    const t = v ?? "";
    if (t.trim()) clean[k] = t;
  }
  if (Object.keys(clean).length === 0) {
    const legacy = (map._note || "").trim();
    return legacy;
  }
  return JSON.stringify(clean);
}

/** Human-readable lines for annotator sidebar. */
export function formatTagDetailsDisplay(raw?: string | null): string {
  const map = parseTagDetails(raw);
  const entries = Object.entries(map).filter(([k, v]) => k !== "_note" && v.trim());
  if (entries.length) {
    return entries.map(([k, v]) => `${k}: ${v}`).join("\n");
  }
  if (map._note?.trim()) return map._note.trim();
  return "";
}
