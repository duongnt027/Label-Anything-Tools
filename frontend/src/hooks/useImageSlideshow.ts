import { useCallback, useEffect, useState } from "react";

export const IMAGE_SLIDESHOW_SPEEDS = [1, 1.5, 2] as const;
export type ImageSlideshowSpeed = (typeof IMAGE_SLIDESHOW_SPEEDS)[number];

/** Pause after each advance completes (×1 slowest, ×2 fastest). */
const SLIDESHOW_GAP_MS: Record<ImageSlideshowSpeed, number> = {
  1: 1650,
  1.5: 950,
  2: 280,
};

export function useImageSlideshow(
  imageCount: number,
  getIdx: () => number,
  goToNext: () => void | Promise<void>,
) {
  const [playing, setPlaying] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(0);
  const speed = IMAGE_SLIDESHOW_SPEEDS[speedIndex];

  const toggle = useCallback(() => setPlaying((p) => !p), []);
  const cycleSpeed = useCallback(() => {
    setSpeedIndex((i) => (i + 1) % IMAGE_SLIDESHOW_SPEEDS.length);
  }, []);

  useEffect(() => {
    if (!playing || imageCount <= 1) return;
    let cancelled = false;

    void (async () => {
      while (!cancelled) {
        await new Promise((r) => window.setTimeout(r, SLIDESHOW_GAP_MS[speed]));
        if (cancelled) return;
        if (getIdx() >= imageCount - 1) {
          setPlaying(false);
          return;
        }
        try {
          await Promise.resolve(goToNext());
        } catch {
          setPlaying(false);
          return;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [playing, imageCount, getIdx, goToNext, speed]);

  useEffect(() => {
    if (imageCount <= 1) setPlaying(false);
  }, [imageCount]);

  return { playing, toggle, setPlaying, speed, cycleSpeed };
}
