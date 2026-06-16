import { useRef, useEffect } from "react";
import { useApp } from "../context/AppContext";
import { send } from "../utils/messaging";
import { deepClone } from "../utils/helpers";
import type { Session, Tab, UndoSnapshot } from "../context/types";

// ─── Module-level drag state (one drag at a time globally) ───────────────────

interface DragState {
  type: "tab" | "window";
  winIdx: number;
  tabSortIdx: number;
  bulk: boolean;
  bulkKeys: Set<string> | null;
}

let _drag: DragState | null = null;

// ─── Auto-scroll ──────────────────────────────────────────────────────────────

let _scrollRaf: number | null = null;
let _scrollDir = 0;

function startAutoScroll(dir: number) {
  _scrollDir = dir;
  if (_scrollRaf) return;
  function step() {
    if (_scrollDir === 0) { _scrollRaf = null; return; }
    document.querySelector(".content-area")?.scrollBy(0, _scrollDir * 8);
    _scrollRaf = requestAnimationFrame(step);
  }
  _scrollRaf = requestAnimationFrame(step);
}

function stopAutoScroll() {
  _scrollDir = 0;
  if (_scrollRaf) { cancelAnimationFrame(_scrollRaf); _scrollRaf = null; }
}

// ─── Visual cleanup ───────────────────────────────────────────────────────────

function clearAllDragClasses() {
  document.querySelectorAll(
    ".dd-tab-above,.dd-tab-below,.dd-win-over,.dd-win-dragging,.dd-session-over,.dd-session-dragging,.dd-session-above,.dd-session-below"
  ).forEach(el => el.classList.remove(
    "dd-tab-above","dd-tab-below","dd-win-over","dd-win-dragging",
    "dd-session-over","dd-session-dragging","dd-session-above","dd-session-below"
  ));
}

function clearWinOverClass() {
  document.querySelectorAll(".window-block.dd-win-over").forEach(b => b.classList.remove("dd-win-over"));
}

function clearTabInsertClasses(block: Element | null) {
  block?.querySelectorAll(".dd-tab-above,.dd-tab-below").forEach(el =>
    el.classList.remove("dd-tab-above","dd-tab-below")
  );
}

// ─── Session drag-drop hook ───────────────────────────────────────────────────

export interface TabDragHandlers {
  draggable: true;
  onDragStart: (e: React.DragEvent<HTMLElement>) => void;
  onDragEnd:   (e: React.DragEvent<HTMLElement>) => void;
  onDragOver:  (e: React.DragEvent<HTMLElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLElement>) => void;
  onDrop:      (e: React.DragEvent<HTMLElement>) => void;
}

export interface WinHeaderDragHandlers {
  draggable: true;
  onDragStart: (e: React.DragEvent<HTMLElement>) => void;
  onDragEnd:   (e: React.DragEvent<HTMLElement>) => void;
  onDragOver:  (e: React.DragEvent<HTMLElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLElement>) => void;
  onDrop:      (e: React.DragEvent<HTMLElement>) => void;
}

export interface WinBodyDragHandlers {
  onDragOver:  (e: React.DragEvent<HTMLElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLElement>) => void;
  onDrop:      (e: React.DragEvent<HTMLElement>) => void;
}

export interface ContentAreaDragHandlers {
  onDragOver:  (e: React.DragEvent<HTMLElement>) => void;
  onDragLeave: () => void;
}

export function useDragDrop(
  session: Session,
  onUpdate: () => Promise<void>
) {
  const { state, pushUndo, toast } = useApp();
  const sessionRef = useRef(session);
  useEffect(() => { sessionRef.current = session; }, [session]);
  const tabRenderOrderRef = useRef(state.tabRenderOrder);
  useEffect(() => { tabRenderOrderRef.current = state.tabRenderOrder; }, [state.tabRenderOrder]);

  useEffect(() => () => stopAutoScroll(), []);

  // ── Persist and refresh ──────────────────────────────────────────────────
  async function persist(s: Session, clearTabSel = false) {
    s.tabCount    = s.windows.reduce((n, w) => n + w.tabs.length, 0);
    s.windowCount = s.windows.length;
    try {
      await send({ type: "updateSession", session: s });
      toast("Collection updated", undefined);
      await onUpdate();
    } catch {
      toast("Failed to save");
    }
    if (clearTabSel) {
      // Selection is stale after re-index; parent re-renders clean it
    }
  }

  // ── Tab move ─────────────────────────────────────────────────────────────
  function applyTabMove(
    srcWin: number, srcTabSort: number,
    dstWin: number, dstTabSort: number
  ) {
    const s = sessionRef.current;
    pushUndo({ type: "session", sessionId: s.id, session: deepClone(s) });

    const srcWindow = s.windows[srcWin];
    const dstWindow = s.windows[dstWin];
    if (!srcWindow || !dstWindow) return;

    const srcSorted = [...srcWindow.tabs].sort((a, b) => a.index - b.index);
    const tab = srcSorted[srcTabSort];
    if (!tab) return;

    srcWindow.tabs = srcWindow.tabs.filter(t => t !== tab);
    srcWindow.tabs.sort((a, b) => a.index - b.index).forEach((t, i) => { t.index = i; });

    let insertAt = dstTabSort;
    if (srcWin === dstWin && srcTabSort < dstTabSort) insertAt = Math.max(0, dstTabSort - 1);
    insertAt = Math.min(insertAt, dstWindow.tabs.length);

    dstWindow.tabs.forEach(t => { if (t.index >= insertAt) t.index++; });
    tab.index = insertAt;

    const dstSorted = [...dstWindow.tabs].sort((a, b) => a.index - b.index);
    const prevTab = dstSorted.filter(t => t.index < insertAt).pop();
    const nextTab = dstSorted.find(t => t.index >= insertAt);
    if (prevTab && nextTab && prevTab.groupId !== -1 && prevTab.groupId === nextTab.groupId) {
      tab.groupId    = prevTab.groupId;
      tab.groupColor = prevTab.groupColor;
      tab.groupTitle = prevTab.groupTitle;
    } else {
      tab.groupId    = -1;
      tab.groupColor = undefined;
      tab.groupTitle = undefined;
    }

    dstWindow.tabs.push(tab);
    if (srcWindow.tabs.length === 0 && srcWin !== dstWin) {
      s.windows.splice(srcWin, 1);
    }

    void persist(s);
  }

  // ── Bulk tab move ─────────────────────────────────────────────────────────
  function applyBulkTabMove(bulkKeys: Set<string>, dstWin: number, dstTabSort: number) {
    const s = sessionRef.current;
    pushUndo({ type: "session", sessionId: s.id, session: deepClone(s) });

    const order = tabRenderOrderRef.current;
    const tabsToMove: Tab[] = order.filter(r => bulkKeys.has(r.key)).map(r => r.tab);
    if (!tabsToMove.length) return;

    const dstWindow = s.windows[dstWin];
    if (!dstWindow) return;
    const tabSet = new Set(tabsToMove);

    const srcWindowOf = new Map<Tab, typeof s.windows[0]>();
    for (const win of s.windows) {
      for (const t of win.tabs) {
        if (tabSet.has(t)) srcWindowOf.set(t, win);
      }
    }

    for (const win of s.windows) {
      win.tabs = win.tabs.filter(t => !tabSet.has(t));
      win.tabs.sort((a, b) => a.index - b.index).forEach((t, i) => { t.index = i; });
    }

    const insertAt = Math.min(dstTabSort, dstWindow.tabs.length);
    dstWindow.tabs.forEach(t => { if (t.index >= insertAt) t.index += tabsToMove.length; });
    tabsToMove.forEach((tab, i) => {
      tab.index = insertAt + i;
      if (srcWindowOf.get(tab) !== dstWindow) {
        tab.groupId    = -1;
        tab.groupColor = undefined;
        tab.groupTitle = undefined;
      }
    });
    dstWindow.tabs.push(...tabsToMove);
    s.windows = s.windows.filter(w => w.tabs.length > 0);

    void persist(s, true);
  }

  // ── Window merge ──────────────────────────────────────────────────────────
  function applyWindowMerge(srcWin: number, dstWin: number) {
    const s = sessionRef.current;
    pushUndo({ type: "session", sessionId: s.id, session: deepClone(s) });

    const srcWindow = s.windows[srcWin];
    s.windows.splice(srcWin, 1);
    const actualDst = srcWin < dstWin ? dstWin - 1 : dstWin;
    const dstWindow = s.windows[actualDst];
    if (!srcWindow || !dstWindow) return;

    const offset = dstWindow.tabs.length;
    for (const tab of srcWindow.tabs) {
      tab.index = offset + tab.index;
      tab.groupId    = -1;
      tab.groupColor = undefined;
      tab.groupTitle = undefined;
      dstWindow.tabs.push(tab);
    }

    void persist(s);
  }

  // ── Handler factories ─────────────────────────────────────────────────────

  function makeTabHandlers(
    winIdx: number,
    tabSortIdx: number,
    tabKey: string,
    selectedKeys: Set<string>
  ): TabDragHandlers {
    return {
      draggable: true,
      onDragStart(e) {
        const isBulk = selectedKeys.has(tabKey) && selectedKeys.size > 1;
        _drag = { type: "tab", winIdx, tabSortIdx, bulk: isBulk, bulkKeys: isBulk ? new Set(selectedKeys) : null };
        e.dataTransfer.effectAllowed = "move";
        setTimeout(() => (e.currentTarget as HTMLElement).classList.add("dd-win-dragging"), 0);
      },
      onDragEnd(e) {
        (e.currentTarget as HTMLElement).classList.remove("dd-win-dragging");
        clearAllDragClasses();
        _drag = null;
        stopAutoScroll();
      },
      onDragOver(e) {
        if (!_drag || _drag.type !== "tab") return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const el = e.currentTarget as HTMLElement;
        const rect = el.getBoundingClientRect();
        clearTabInsertClasses(el.closest(".window-block"));
        el.classList.add(e.clientY < rect.top + rect.height / 2 ? "dd-tab-above" : "dd-tab-below");
      },
      onDragLeave(e) {
        (e.currentTarget as HTMLElement).classList.remove("dd-tab-above","dd-tab-below");
      },
      onDrop(e) {
        e.preventDefault();
        if (!_drag || _drag.type !== "tab") return;
        const el = e.currentTarget as HTMLElement;
        const above = el.classList.contains("dd-tab-above");
        el.classList.remove("dd-tab-above","dd-tab-below");
        const insertAt = above ? tabSortIdx : tabSortIdx + 1;
        if (_drag.bulk && _drag.bulkKeys) {
          applyBulkTabMove(_drag.bulkKeys, winIdx, insertAt);
        } else {
          applyTabMove(_drag.winIdx, _drag.tabSortIdx, winIdx, insertAt);
        }
      },
    };
  }

  function makeWindowHeaderHandlers(winIdx: number, blockRef: React.RefObject<HTMLDivElement | null>): WinHeaderDragHandlers {
    return {
      draggable: true,
      onDragStart(e) {
        if ((e.target as HTMLElement).closest(".tab-row")) return;
        e.stopPropagation();
        _drag = { type: "window", winIdx, tabSortIdx: 0, bulk: false, bulkKeys: null };
        e.dataTransfer.effectAllowed = "move";
        setTimeout(() => blockRef.current?.classList.add("dd-win-dragging"), 0);
      },
      onDragEnd() {
        blockRef.current?.classList.remove("dd-win-dragging");
        clearAllDragClasses();
        _drag = null;
        stopAutoScroll();
      },
      onDragOver(e) {
        if (!_drag || _drag.type !== "window" || _drag.winIdx === winIdx) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        clearWinOverClass();
        blockRef.current?.classList.add("dd-win-over");
      },
      onDragLeave(e) {
        if (blockRef.current && !blockRef.current.contains(e.relatedTarget as Node)) {
          blockRef.current.classList.remove("dd-win-over");
        }
      },
      onDrop(e) {
        e.preventDefault();
        blockRef.current?.classList.remove("dd-win-over");
        if (!_drag || _drag.type !== "window" || _drag.winIdx === winIdx) return;
        applyWindowMerge(_drag.winIdx, winIdx);
      },
    };
  }

  function makeWindowBodyHandlers(winIdx: number, blockRef: React.RefObject<HTMLDivElement | null>): WinBodyDragHandlers {
    return {
      onDragOver(e) {
        if (!_drag || _drag.type !== "tab") return;
        if (_drag.winIdx === winIdx && !_drag.bulk) return;
        if ((e.target as HTMLElement).closest(".tab-row")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        clearWinOverClass();
        blockRef.current?.classList.add("dd-win-over");
      },
      onDragLeave(e) {
        if (blockRef.current && !blockRef.current.contains(e.relatedTarget as Node)) {
          blockRef.current.classList.remove("dd-win-over");
        }
      },
      onDrop(e) {
        if ((e.target as HTMLElement).closest(".tab-row")) return;
        e.preventDefault();
        blockRef.current?.classList.remove("dd-win-over");
        if (!_drag || _drag.type !== "tab") return;
        if (_drag.winIdx === winIdx && !_drag.bulk) return;
        const dst = sessionRef.current.windows[winIdx]?.tabs.length ?? 0;
        if (_drag.bulk && _drag.bulkKeys) {
          applyBulkTabMove(_drag.bulkKeys, winIdx, dst);
        } else {
          applyTabMove(_drag.winIdx, _drag.tabSortIdx, winIdx, dst);
        }
      },
    };
  }

  const contentAreaHandlers: ContentAreaDragHandlers = {
    onDragOver(e) {
      if (!_drag) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const ZONE = 80;
      if (e.clientY < rect.top + ZONE) startAutoScroll(-1);
      else if (e.clientY > rect.bottom - ZONE) startAutoScroll(1);
      else stopAutoScroll();
    },
    onDragLeave() { stopAutoScroll(); },
  };

  return { makeTabHandlers, makeWindowHeaderHandlers, makeWindowBodyHandlers, contentAreaHandlers };
}

// ─── Sidebar session drag-drop ────────────────────────────────────────────────

interface SidebarDragCallbacks {
  pushUndo: (s: UndoSnapshot) => void;
  toast: (msg: string, action?: () => void) => void;
  sessions: Session[];
  showModal: (title: string, body: string, actions: Array<{ label: string; cls?: string; action: () => void }>) => void;
  hideModal: () => void;
  onUpdate: () => Promise<void>;
  onNavigate: (id: string) => void;
  currentView: string;
}

interface SessionItemDragHandlers {
  draggable: true;
  onDragStart: (e: React.DragEvent<HTMLElement>) => void;
  onDragEnd:   (e: React.DragEvent<HTMLElement>) => void;
  onDragOver:  (e: React.DragEvent<HTMLElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLElement>) => void;
  onDrop:      (e: React.DragEvent<HTMLElement>) => void;
}

let _sidebarDrag: { id: string } | null = null;

export function makeSidebarItemHandlers(
  sessionId: string,
  cb: SidebarDragCallbacks
): SessionItemDragHandlers {
  return {
    draggable: true,
    onDragStart(e) {
      _sidebarDrag = { id: sessionId };
      e.dataTransfer.effectAllowed = "move";
      (e.currentTarget as HTMLElement).classList.add("dd-session-dragging");
    },
    onDragEnd(e) {
      (e.currentTarget as HTMLElement).classList.remove("dd-session-dragging");
      clearAllDragClasses();
      _sidebarDrag = null;
    },
    onDragOver(e) {
      if (!_sidebarDrag || _sidebarDrag.id === sessionId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const el = e.currentTarget as HTMLElement;
      el.classList.remove("dd-session-over","dd-session-above","dd-session-below");
      const rect = el.getBoundingClientRect();
      const pct = (e.clientY - rect.top) / rect.height;
      if (pct < 0.35)       el.classList.add("dd-session-above");
      else if (pct > 0.65)  el.classList.add("dd-session-below");
      else                   el.classList.add("dd-session-over");
    },
    onDragLeave(e) {
      (e.currentTarget as HTMLElement).classList.remove("dd-session-over","dd-session-above","dd-session-below");
    },
    async onDrop(e) {
      e.preventDefault();
      const el = e.currentTarget as HTMLElement;
      const isAbove = el.classList.contains("dd-session-above");
      const isBelow = el.classList.contains("dd-session-below");
      const isMerge = el.classList.contains("dd-session-over");
      el.classList.remove("dd-session-over","dd-session-above","dd-session-below");

      if (!_sidebarDrag || _sidebarDrag.id === sessionId) return;
      const srcId = _sidebarDrag.id;
      _sidebarDrag = null;

      if (isAbove || isBelow) {
        const oldOrder = cb.sessions.map(s => s.id);
        // cb.pushUndo expects UndoSnapshot - we use reorder type
        // @ts-ignore - dynamic union call
        cb.pushUndo({ type: "reorder", oldOrder });
        const order = [...oldOrder];
        const srcIdx = order.indexOf(srcId);
        order.splice(srcIdx, 1);
        const dstIdx = order.indexOf(sessionId);
        order.splice(isAbove ? dstIdx : dstIdx + 1, 0, srcId);
        await send({ type: "reorderSessions", order });
        await cb.onUpdate();
        return;
      }

      if (!isMerge) return;

      const srcName = cb.sessions.find(s => s.id === srcId)?.name ?? "collection";
      const dstName = cb.sessions.find(s => s.id === sessionId)?.name ?? "collection";
      const srcEsc = srcName.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
      const dstEsc = dstName.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

      cb.showModal(
        "Merge collections",
        `<p>Merge <strong>${srcEsc}</strong> into <strong>${dstEsc}</strong>?<br>The source collection will be deleted.</p>`,
        [
          { label: "Cancel", cls: "btn-ghost", action: cb.hideModal },
          {
            label: "Merge", cls: "btn-primary", action: async () => {
              cb.hideModal();
              const [src, dst] = await Promise.all([
                send({ type: "getSession", id: srcId }),
                send({ type: "getSession", id: sessionId }),
              ]) as [Session, Session];
              if (!src || !dst) { cb.toast("Could not load collections"); return; }

              // @ts-ignore
              cb.pushUndo({ type: "merge", srcSession: deepClone(src), dstSession: deepClone(dst) });

              dst.windows     = [...dst.windows, ...src.windows];
              dst.tabCount    = dst.windows.reduce((s, w) => s + w.tabs.length, 0);
              dst.windowCount = dst.windows.length;

              await send({ type: "updateSession", session: dst });
              await send({ type: "deleteSession", id: srcId });
              cb.toast(`Merged into "${dst.name}"`, undefined);
              await cb.onUpdate();

              if (cb.currentView === srcId) cb.onNavigate(sessionId);
            }
          },
        ]
      );
    },
  };
}
