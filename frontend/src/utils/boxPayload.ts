import { Box } from "../api";

export function cloneBox(b: Box): Box {
  return { ...b, tag: [...(b.tag || [])] };
}

/** Body for POST /api/images/{id}/boxes (recreate after undo delete). */
export function boxCreatePayload(b: Box) {
  return {
    class: b.class || "default",
    box_points: b.box_points,
    segment_points: b.segment_points || "",
    ocr_text: b.ocr_text || "",
    caption: b.caption || "",
    details: b.details ?? "",
  };
}

export type BoxGeometry = { box_points: string; segment_points: string };

export function boxGeometry(b: Box): BoxGeometry {
  return { box_points: b.box_points, segment_points: b.segment_points || "" };
}

let optimisticSeq = 0;

/** Placeholder box shown until POST /boxes returns (avoids canvas flicker). */
export function makeOptimisticBox(
  imgId: number,
  partial: Pick<Box, "class" | "box_points"> & {
    segment_points?: string;
    details?: string;
  },
): Box {
  optimisticSeq -= 1;
  return {
    id: optimisticSeq,
    img_id: imgId,
    class: partial.class || "default",
    box_points: partial.box_points,
    segment_points: partial.segment_points || "",
    ocr_text: "",
    caption: "",
    details: partial.details,
    tag: [],
    status: "Unseen",
  };
}
