/** Distinct hues for class chips — maximally spaced on the color wheel */
const GOLDEN_ANGLE = 137.508;

export function classColor(index: number): string {
  const hue = (index * GOLDEN_ANGLE) % 360;
  return `hsl(${hue} 65% 45%)`;
}

export function classColorBg(index: number): string {
  const hue = (index * GOLDEN_ANGLE) % 360;
  return `hsla(${hue}, 65%, 45%, 0.22)`;
}

export function nextClassColor(existingCount: number): { border: string; bg: string } {
  return { border: classColor(existingCount), bg: classColorBg(existingCount) };
}
