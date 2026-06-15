export const GROUP_COLORS: Record<string, string> = {
  blue:   "#1a73e8",
  red:    "#e53935",
  yellow: "#f9ab00",
  green:  "#1e8e3e",
  pink:   "#e91e8c",
  purple: "#9334e6",
  cyan:   "#007b83",
  orange: "#e8430a",
  grey:   "#5f6368",
  gray:   "#5f6368",
};

export function grpHex(color: string): string {
  return GROUP_COLORS[color] ?? GROUP_COLORS["grey"]!;
}

export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatDate(ts: number): string {
  const d = new Date(ts);
  return (
    d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
    " " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
}

export function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function safeFilename(name: string): string {
  return name.replace(/[^a-z0-9_\-. ]/gi, "_").slice(0, 60) || "session";
}

export function tabCountLabel(n: number): string {
  return `${n} tab${n !== 1 ? "s" : ""}`;
}

export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export function formatHistoryTime(date: number): string {
  return new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatHistoryDate(date: number): string {
  const d = new Date(date);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export function historyTypeLabel(type: string): string {
  if (type === "browserClosed") return "Browser closed";
  if (type === "autoSave") return "Auto-save";
  return "Saved";
}
