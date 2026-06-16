import { safeFilename } from "./helpers";
import type { Session } from "../context/types";

async function downloadFileSaveAs(filename: string, content: string, mimeType: string): Promise<void> {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    // Try the downloads API first (shows a Save As dialog)
    await browser.downloads.download({ url, filename, saveAs: true });
  } catch {
    // Fallback: must be in the document for Firefox to honour the download attribute
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function exportSessionAsJson(session: Session): void {
  const json = JSON.stringify([session], null, 2);
  void downloadFileSaveAs(`${safeFilename(session.name)}.json`, json, "application/json");
}

export function exportSessionAsText(session: Session): void {
  const lines: string[] = [session.name];
  const multiWin = session.windows.length > 1;

  for (let wi = 0; wi < session.windows.length; wi++) {
    const win = session.windows[wi];
    const winLabel = win.name || (multiWin ? `Window ${wi + 1}` : null);
    if (winLabel) lines.push(`  ${winLabel}${win.incognito ? " [Private]" : ""}`);

    const sorted = [...win.tabs].sort((a, b) => a.index - b.index);
    let lastGroupId: number | null = null;

    for (const tab of sorted) {
      const gid = tab.groupId ?? -1;

      if (gid !== -1 && gid !== lastGroupId) {
        const title = tab.groupTitle?.trim() || "Group";
        lines.push(`    [${title}]`);
      }
      lastGroupId = gid !== -1 ? gid : null;

      // Escape " | " in titles so it doesn't break the parser's separator
      const title = (tab.title || tab.url || "").replace(/ \| /g, " - ");
      const pin = tab.pinned ? "📌 " : "";
      const entry = `${pin}${title} | ${tab.url}`;
      lines.push(gid !== -1 ? `      ${entry}` : `    ${entry}`);
    }
  }

  void downloadFileSaveAs(`${safeFilename(session.name)}.txt`, lines.join("\n"), "text/plain");
}

export async function exportBackup(data: Record<string, unknown>): Promise<void> {
  const json = JSON.stringify({ ...data, version: 1, exportedAt: Date.now() }, null, 2);
  const date = new Date().toISOString().slice(0, 10);
  await downloadFileSaveAs(`tabkeeper-backup-${date}.json`, json, "application/json");
}
