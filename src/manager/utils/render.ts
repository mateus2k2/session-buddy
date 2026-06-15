export function highlightMatch(text: string, query: string): string {
  if (!query) return escapeHtml(text);
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return escapeHtml(text);
  return (
    escapeHtml(text.slice(0, idx)) +
    `<mark>${escapeHtml(text.slice(idx, idx + query.length))}</mark>` +
    escapeHtml(text.slice(idx + query.length))
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function windowLabel(name: string | undefined, idx: number, total: number): string {
  if (name) return name;
  return total === 1 ? "Window" : `Window ${idx + 1}`;
}

export function getFaviconUrl(url: string, favIconUrl?: string): string | null {
  if (favIconUrl && !favIconUrl.startsWith("chrome://") && !favIconUrl.startsWith("moz-extension://")) {
    return favIconUrl;
  }
  try {
    const u = new URL(url);
    if (u.protocol === "http:" || u.protocol === "https:") {
      return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=16`;
    }
  } catch { /* ignore */ }
  return null;
}
