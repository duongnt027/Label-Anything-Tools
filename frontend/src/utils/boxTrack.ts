import { parseTagDetails, serializeTagDetails } from "./tagDetails";

const INTERNAL_KEYS = new Set(["_track", "_track_from"]);

export function getBoxTrackId(details?: string | null): string | null {
  const id = parseTagDetails(details)._track?.trim();
  return id || null;
}

export function getBoxTrackFromIndex(details?: string | null): number | null {
  const raw = parseTagDetails(details)._track_from?.trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function withBoxTrackMeta(
  details: string | undefined,
  trackId: string,
  fromFrameIndex: number,
): string {
  const m = parseTagDetails(details);
  m._track = trackId;
  m._track_from = String(fromFrameIndex);
  return serializeTagDetails(m);
}

export function withBoxTrackId(details: string | undefined, trackId: string): string {
  return withBoxTrackMeta(details, trackId, 0);
}

export function isInternalTrackKey(k: string): boolean {
  return INTERNAL_KEYS.has(k);
}
