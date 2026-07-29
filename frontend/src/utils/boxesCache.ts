import { api, Box } from "../api";
import { getBoxTrackId } from "./boxTrack";

export type BoxesCache = Map<number, Box[]>;

export async function fetchJobImageBoxes(
  jobId: string | number,
  imageId: number,
  cache: BoxesCache,
): Promise<Box[]> {
  const hit = cache.get(imageId);
  if (hit) return hit;
  const boxes = await api<Box[]>(`/api/jobs/${jobId}/images/${imageId}/boxes`);
  cache.set(imageId, boxes);
  return boxes;
}

export async function fetchImageBoxes(imageId: number, cache: BoxesCache): Promise<Box[]> {
  const hit = cache.get(imageId);
  if (hit) return hit;
  const boxes = await api<Box[]>(`/api/images/${imageId}/boxes`);
  cache.set(imageId, boxes);
  return boxes;
}

export function prefetchJobImageBoxes(
  jobId: string | number,
  imageId: number,
  cache: BoxesCache,
): void {
  if (cache.has(imageId)) return;
  void fetchJobImageBoxes(jobId, imageId, cache).catch(() => {});
}

export function prefetchImageBoxes(imageId: number, cache: BoxesCache): void {
  if (cache.has(imageId)) return;
  void fetchImageBoxes(imageId, cache).catch(() => {});
}

export function invalidateBoxesCache(cache: BoxesCache, imageIds: Iterable<number>): void {
  for (const id of imageIds) cache.delete(id);
}

export function appendBoxToCache(cache: BoxesCache, imageId: number, box: Box): void {
  const cur = cache.get(imageId);
  cache.set(imageId, cur ? [...cur, box] : [box]);
}

export function stripTrackFromCache(cache: BoxesCache, trackId: string, imageIds: Iterable<number>): void {
  for (const id of imageIds) {
    const list = cache.get(id);
    if (!list?.length) continue;
    const filtered = list.filter((b) => getBoxTrackId(b.details) !== trackId);
    if (filtered.length !== list.length) cache.set(id, filtered);
  }
}

export async function fetchJobImageBoxesFresh(
  jobId: string | number,
  imageId: number,
  cache: BoxesCache,
): Promise<Box[]> {
  cache.delete(imageId);
  return fetchJobImageBoxes(jobId, imageId, cache);
}
