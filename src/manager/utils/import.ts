import { genId } from "./helpers";
import type { Session, Window as SessionWindow, Tab } from "../context/types";

function getIndentLevel(line: string): number {
  let spaces = 0;
  for (const ch of line) {
    if (ch === " ") spaces++;
    else if (ch === "\t") spaces += 2;
    else break;
  }
  return Math.floor(spaces / 2);
}

function parseTabLine(raw: string): { title: string; url: string; pinned: boolean } | null {
  const line = raw.trim().replace(/^📌\s*/, "");
  const pinned = raw.trim().startsWith("📌");
  const sep = line.indexOf(" | ");
  if (sep !== -1) {
    return { title: line.slice(0, sep).trim(), url: line.slice(sep + 3).trim(), pinned };
  }
  if (line.startsWith("http://") || line.startsWith("https://")) {
    return { title: line, url: line, pinned };
  }
  return null;
}

export function parseTextImport(text: string): Session[] {
  const sessions: Session[] = [];
  let cur: Session | null = null;
  let curWin: SessionWindow | null = null;
  let curGroupId: string | null = null;

  const ensureSession = (name = "Imported Session") => {
    if (!cur) {
      cur = { id: genId(), name, date: Date.now(), windows: [], tabCount: 0, windowCount: 0 };
      sessions.push(cur);
    }
  };

  const ensureWindow = () => {
    ensureSession();
    if (!curWin) {
      curWin = { tabs: [], incognito: false };
      cur!.windows.push(curWin);
    }
  };

  for (const rawLine of text.split("\n")) {
    const trimmed = rawLine.trim();
    const level = getIndentLevel(rawLine);

    if (!trimmed) { curGroupId = null; continue; }
    if (trimmed === "---") { cur = null; curWin = null; curGroupId = null; continue; }

    if (level === 0) {
      if (trimmed.startsWith("Saved:")) continue;
      curWin = null; curGroupId = null;
      cur = { id: genId(), name: trimmed, date: Date.now(), windows: [], tabCount: 0, windowCount: 0 };
      sessions.push(cur);
    } else if (level === 1) {
      ensureSession();
      const isPrivate = trimmed.includes("[Private]");
      curWin = { tabs: [], incognito: isPrivate };
      curGroupId = null;
      cur!.windows.push(curWin);
    } else if (level === 2) {
      ensureWindow();
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        curGroupId = genId();
      } else {
        const tab = parseTabLine(trimmed);
        if (tab && curWin) {
          curWin.tabs.push({ ...tab, index: curWin.tabs.length, groupId: -1 } as Tab);
        }
      }
    } else {
      ensureWindow();
      const tab = parseTabLine(trimmed);
      if (tab && curWin) {
        curWin.tabs.push({ ...tab, index: curWin.tabs.length, groupId: curGroupId ? 0 : -1 } as Tab);
      }
    }
  }

  return sessions
    .map(s => ({
      ...s,
      tabCount: s.windows.reduce((n, w) => n + w.tabs.length, 0),
      windowCount: s.windows.length,
    }))
    .filter(s => s.tabCount > 0);
}

export function parseUrlList(text: string): { name?: string; tabs: Tab[]; incognito: boolean }[] {
  const lines = text.split(/\r?\n/);
  const hasIndented = lines.some(l => /^[ \t]/.test(l) && l.trim());

  const isUrl = (s: string) => /^(https?|file|ftp):\/\//i.test(s);
  const makeTab = (url: string, idx: number): Tab => ({ url, title: url, index: idx });

  if (!hasIndented) {
    const tabs = lines.map(l => l.trim()).filter(isUrl).map(makeTab);
    return tabs.length ? [{ tabs, incognito: false }] : [];
  }

  const wins: { name?: string; tabs: Tab[]; incognito: boolean }[] = [{ tabs: [], incognito: false }];
  let currentWin = wins[0];

  for (const raw of lines) {
    const indented = /^[ \t]/.test(raw);
    const line = raw.trim();
    if (!line) continue;

    if (!indented) {
      if (isUrl(line)) {
        if (currentWin.tabs.length === 0 && !currentWin.name) {
          currentWin.tabs.push(makeTab(line, 0));
        } else {
          currentWin = { tabs: [makeTab(line, 0)], incognito: false };
          wins.push(currentWin);
        }
      } else {
        currentWin = { name: line, tabs: [], incognito: false };
        wins.push(currentWin);
      }
    } else {
      if (isUrl(line)) currentWin.tabs.push(makeTab(line, currentWin.tabs.length));
    }
  }

  return wins.filter(w => w.tabs.length > 0);
}
