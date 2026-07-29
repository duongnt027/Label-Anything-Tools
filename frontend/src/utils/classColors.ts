/**
 * Maximally distinct class colors via golden-angle hues.
 * Index = position in task.classes (append-only) so existing colors stay stable
 * when new classes are added at the end.
 */
const GOLDEN_ANGLE = 137.508;

/** Border colors for outlined class chips — higher saturation like design reference. */
function hslParts(index: number): { h: number; s: number; l: number } {
  const h = (index * GOLDEN_ANGLE) % 360;
  const s = 68 + ((index * 5) % 14); // 68–81%
  const l = 52 + ((index * 9) % 12); // 52–63%
  return { h, s, l };
}

export function classColor(index: number): string {
  const { h, s, l } = hslParts(Math.max(0, index));
  return `hsl(${h} ${s}% ${l}%)`;
}

export function classColorBg(index: number): string {
  const { h, s, l } = hslParts(Math.max(0, index));
  return `hsla(${h}, ${s}%, ${l}%, 0.22)`;
}

/** Build lowercase → index from task class order (do not sort). */
export function buildClassColorIndex(classes: string[]): Map<string, number> {
  const map = new Map<string, number>();
  classes.forEach((c, i) => {
    const key = c.toLowerCase();
    if (!map.has(key)) map.set(key, i);
  });
  return map;
}

/**
 * Color for a class name. Prefer task-list index (maximally spaced).
 * Unknown names get a hash slot in a sparse band so they rarely collide with listed ones.
 */
export function classColorForName(className: string, classIndex?: Map<string, number>): string {
  const key = (className || "?").trim().toLowerCase() || "?";
  const idx = classIndex?.get(key);
  if (idx != null) return classColor(idx);
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  // Offset into a later band so unknown labels don't steal early golden slots
  return classColor(48 + (Math.abs(h) % 48));
}

/** Text color readable on top of `classColor` fill. */
export function classContrastText(hslBorder: string): string {
  const m = hslBorder.match(/(\d+(?:\.\d+)?)\s*%\s*\)/);
  const lightness = m ? parseFloat(m[1]) : 45;
  return lightness > 52 ? "#0b0f17" : "#f8fafc";
}

export function nextClassColor(existingCount: number): { border: string; bg: string } {
  return { border: classColor(existingCount), bg: classColorBg(existingCount) };
}
