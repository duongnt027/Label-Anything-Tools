export function roleBadgeClass(role: string): string {
  const base = "user-badge";
  if (role === "admin") return `${base} user-badge-admin`;
  if (role === "reviewer") return `${base} user-badge-reviewer`;
  return `${base} user-badge-annotator`;
}
