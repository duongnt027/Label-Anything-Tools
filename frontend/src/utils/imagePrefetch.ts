import { imageUrl } from "../api";

const imagePromises = new Map<string, Promise<HTMLImageElement>>();
const imageResolved = new Map<string, HTMLImageElement>();
const imageResolvedOrder: string[] = [];

const MAX_RESOLVED_IMAGES = 48;

function rememberResolved(url: string, img: HTMLImageElement) {
  if (imageResolved.has(url)) {
    const i = imageResolvedOrder.indexOf(url);
    if (i >= 0) imageResolvedOrder.splice(i, 1);
  } else if (imageResolvedOrder.length >= MAX_RESOLVED_IMAGES) {
    const evict = imageResolvedOrder.shift();
    if (evict) {
      imageResolved.delete(evict);
      imagePromises.delete(evict);
    }
  }
  imageResolved.set(url, img);
  imageResolvedOrder.push(url);
}

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
        rememberResolved(url, i);
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
