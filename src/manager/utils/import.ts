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
  let curGroupId: number | null = null;
  let curGroupTitle: string | null = null;
  let curGroupColor: string | undefined = undefined;
  let groupCounter = 0;

  const resetGroup = () => { curGroupId = null; curGroupTitle = null; curGroupColor = undefined; };

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

    if (!trimmed) { resetGroup(); continue; }
    if (trimmed === "---") { cur = null; curWin = null; groupCounter = 0; resetGroup(); continue; }

    if (level === 0) {
      if (trimmed.startsWith("Saved:")) continue;
      const asTab = parseTabLine(trimmed);
      if (asTab) {
        // Plain URL at level 0 — add to current session/window instead of creating a new session
        ensureWindow();
        curWin!.tabs.push({ ...asTab, index: curWin!.tabs.length, groupId: curGroupId ?? -1,
          groupTitle: curGroupTitle ?? undefined, groupColor: curGroupColor } as Tab);
      } else {
        // Non-URL text — it's a session name
        curWin = null; groupCounter = 0; resetGroup();
        cur = { id: genId(), name: trimmed, date: Date.now(), windows: [], tabCount: 0, windowCount: 0 };
        sessions.push(cur);
      }
    } else if (level === 1) {
      const asTab = parseTabLine(trimmed);
      if (asTab) {
        // URL at level 1 — treat as an ungrouped tab, not a window header
        ensureWindow();
        resetGroup();
        curWin!.tabs.push({ ...asTab, index: curWin!.tabs.length, groupId: -1 } as Tab);
      } else {
        // Non-URL text — it's a window header
        ensureSession();
        const isPrivate = trimmed.includes("[Private]");
        curWin = { tabs: [], incognito: isPrivate };
        groupCounter = 0; resetGroup();
        cur!.windows.push(curWin);
      }
    } else if (level === 2) {
      ensureWindow();
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        // Group header: "[Title]" or "[Title | color]"
        const inner = trimmed.slice(1, -1);
        const pipe = inner.indexOf(" | ");
        curGroupTitle = (pipe !== -1 ? inner.slice(0, pipe) : inner).trim();
        curGroupColor = pipe !== -1 ? inner.slice(pipe + 3).trim() : undefined;
        curGroupId = ++groupCounter;
      } else {
        resetGroup();
        const tab = parseTabLine(trimmed);
        if (tab && curWin) {
          curWin.tabs.push({ ...tab, index: curWin.tabs.length, groupId: -1 } as Tab);
        }
      }
    } else {
      ensureWindow();
      const tab = parseTabLine(trimmed);
      if (tab && curWin) {
        curWin.tabs.push({
          ...tab,
          index: curWin.tabs.length,
          groupId: curGroupId ?? -1,
          groupTitle: curGroupTitle ?? undefined,
          groupColor: curGroupColor,
        } as Tab);
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

export function smartImportText(text: string): Session[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Try JSON
  try {
    const data = JSON.parse(trimmed) as unknown;
    const all: Session[] = Array.isArray(data) ? (data as Session[]) : [data as Session];
    const valid = all.filter(s => s && typeof s === "object" && Array.isArray((s as Session).windows));
    if (valid.length > 0) return valid;
  } catch { /* not JSON */ }

  // Try structured text export
  const textSessions = parseTextImport(trimmed);
  if (textSessions.length > 0) return textSessions;

  // Fall back to plain URL list
  const urls = trimmed.split("\n").map(u => u.trim()).filter(u => /^https?:\/\//i.test(u));
  if (urls.length > 0) {
    return [{
      id: genId(),
      name: new Date().toLocaleString(),
      date: Date.now(),
      windowCount: 1,
      tabCount: urls.length,
      windows: [{ tabs: urls.map((url, i): Tab => ({ index: i, url, title: url })) }],
    }];
  }

  return [];
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
