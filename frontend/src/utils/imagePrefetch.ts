import { imageUrl } from "../api";

const imagePromises = new Map<string, Promise<HTMLImageElement>>();
const imageResolved = new Map<string, HTMLImageElement>();

export function getCachedImage(url: string): HTMLImageElement | null {
  return imageResolved.get(url) ?? null;
}

export function preloadImageUrl(url: string): Promise<HTMLImageElement> {
  const hit = imageResolved.get(url);
  if (hit) return Promise.resolve(hit);
  let p = imagePromises.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => {
        imageResolved.set(url, i);
        imagePromises.delete(url);
        resolve(i);
      };
      i.onerror = () => {
        imagePromises.delete(url);
        reject(new Error("Image load failed"));
      };
      i.src = url;
    });
    imagePromises.set(url, p);
  }
  return p;
}

export function preloadImageId(imageId: number): Promise<HTMLImageElement> {
  return preloadImageUrl(imageUrl(imageId));
}
