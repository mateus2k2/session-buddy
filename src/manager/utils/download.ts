import { safeFilename } from "./helpers";
import type { Session } from "../context/types";

async function downloadFileSaveAs(filename: string, content: string, mimeType: string): Promise<void> {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    await browser.downloads.download({ url, filename, saveAs: true });
  } catch {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function exportSessionAsJson(session: Session): void {
  const json = JSON.stringify([session], null, 2);
  void downloadFileSaveAs(`${safeFilename(session.name)}.json`, json, "application/json");
}

export function exportSessionAsText(session: Session): void {
  const lines: string[] = [];
  for (const win of session.windows) {
    if (win.name) lines.push(`# ${win.name}`);
    for (const tab of [...win.tabs].sort((a, b) => a.index - b.index)) {
      lines.push(tab.url);
    }
    lines.push("");
  }
  void downloadFileSaveAs(`${safeFilename(session.name)}.txt`, lines.join("\n"), "text/plain");
}

export async function exportBackup(data: Record<string, unknown>): Promise<void> {
  const json = JSON.stringify({ ...data, version: 1, exportedAt: Date.now() }, null, 2);
  const date = new Date().toISOString().slice(0, 10);
  await downloadFileSaveAs(`tabkeeper-backup-${date}.json`, json, "application/json");
}
