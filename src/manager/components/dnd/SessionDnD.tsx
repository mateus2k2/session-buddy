import { createContext, useContext, useRef, useState, useEffect } from "react";
import { DragDropProvider, DragOverlay } from "@dnd-kit/react";
import { move } from "@dnd-kit/helpers";
import { useApp } from "../../context/AppContext";
import { send } from "../../utils/messaging";
import { deepClone, esc } from "../../utils/helpers";
import type { Session, Tab } from "../../context/types";

// ─── Drag state context (lets WindowBlock read optimistic tab order) ──────────

export interface DragState {
  // maps window key ('w0', 'w1') → ordered tab IDs
  tabOrder: Record<string, string[]>;
  // maps tab ID → tab object
  tabMap: Record<string, Tab>;
}

const DragStateCtx = createContext<DragState>({ tabOrder: {}, tabMap: {} });
export const useDragState = () => useContext(DragStateCtx);

// ─── SessionDnD ───────────────────────────────────────────────────────────────

interface Props {
  session: Session;
  onUpdate: () => Promise<void>;
  children: React.ReactNode;
}

export function SessionDnD({ session, onUpdate, children }: Props) {
  const { dispatch, toast, pushUndo, showModal, hideModal } = useApp();

  const [tabOrder, setTabOrder] = useState<Record<string, string[]>>({});
  const tabOrderRef = useRef<Record<string, string[]>>({});
  const tabMapRef = useRef<Record<string, Tab>>({});
  const prevTabOrder = useRef<Record<string, string[]>>({});
  const prevTabMap = useRef<Record<string, Tab>>({});

  // Rebuild tabOrder and tabMap whenever the session changes (after save or on load)
  useEffect(() => {
    const order: Record<string, string[]> = {};
    const dataMap: Record<string, Tab> = {};
    session.windows.forEach((win, wi) => {
      const winKey = `w${wi}`;
      order[winKey] = [];
      [...win.tabs].sort((a, b) => a.index - b.index).forEach((tab, ti) => {
        const tabId = `${session.id}-w${wi}-t${ti}`;
        order[winKey].push(tabId);
        dataMap[tabId] = tab;
      });
    });
    tabOrderRef.current = order;
    setTabOrder(order);
    tabMapRef.current = dataMap;
  }, [session]);

  function onDragStart() {
    prevTabOrder.current = tabOrderRef.current;
    prevTabMap.current = { ...tabMapRef.current };
  }

  function onDragOver(event: any) {
    const source = event.operation?.source;
    if (source?.type !== "item") return;

    const draggedId = source.id as string;
    const newOrder = move(tabOrderRef.current, event);

    // Reflect the dragged tab's new group membership live so group labels update during drag
    for (const [winKey, tabIds] of Object.entries(newOrder)) {
      const idx = tabIds.indexOf(draggedId);
      if (idx === -1) continue;

      const origWinKey = Object.entries(prevTabOrder.current).find(
        ([, ids]) => ids.includes(draggedId)
      )?.[0];
      const movedAcrossWindow = origWinKey !== winKey;

      let groupId = -1;
      let groupColor: string | undefined;
      let groupTitle: string | undefined;

      if (!movedAcrossWindow) {
        const aboveId = idx > 0 ? tabIds[idx - 1] : null;
        const belowId = idx < tabIds.length - 1 ? tabIds[idx + 1] : null;
        const above = aboveId ? prevTabMap.current[aboveId] : null;
        const below = belowId ? prevTabMap.current[belowId] : null;
        const srcGroup =
          above?.groupId && above.groupId !== -1 ? above :
          below?.groupId && below.groupId !== -1 ? below : null;
        groupId = srcGroup?.groupId ?? -1;
        groupColor = srcGroup?.groupColor;
        groupTitle = srcGroup?.groupTitle;
      }

      tabMapRef.current = {
        ...tabMapRef.current,
        [draggedId]: { ...tabMapRef.current[draggedId], groupId, groupColor, groupTitle },
      };
      break;
    }

    tabOrderRef.current = newOrder;
    setTabOrder(newOrder);
  }

  function onDragEnd(event: any) {
    const { operation, canceled } = event;
    const source = operation?.source;
    const target = operation?.target;

    if (canceled) {
      if (source?.type === "item") {
        tabOrderRef.current = prevTabOrder.current;
        setTabOrder(prevTabOrder.current);
        tabMapRef.current = prevTabMap.current;
      }
      return;
    }

    if (source?.type === "item") {
      commitTabsToSession(tabOrderRef.current, source.id as string);
    } else if (source?.type === "window" && target && source.id !== target.id) {
      const srcWinKey = source.id as string;
      const dstWinKey = target.id as string;
      const srcWi = parseInt(srcWinKey.slice(1));
      const dstWi = parseInt(dstWinKey.slice(1));
      const srcWin = session.windows[srcWi];
      const dstWin = session.windows[dstWi];
      if (!srcWin || !dstWin) return;

      showModal(
        "Merge windows",
        `<p>Merge <strong>${esc(srcWin.name ?? `Window ${srcWi + 1}`)}</strong> into <strong>${esc(dstWin.name ?? `Window ${dstWi + 1}`)}</strong>? This cannot be undone easily.</p>`,
        [
          { label: "Cancel", cls: "btn-ghost", action: hideModal },
          {
            label: "Merge", cls: "btn-danger", action: () => {
              hideModal();
              mergeWindows(srcWi, dstWi);
            }
          },
        ]
      );
    }
  }

  function commitTabsToSession(order: Record<string, string[]>, draggedTabId: string | null = null) {
    const originalWindowOf: Record<string, string> = {};
    Object.entries(prevTabOrder.current).forEach(([winKey, tabIds]) => {
      tabIds.forEach(id => { originalWindowOf[id] = winKey; });
    });

    const newWindows = Object.entries(order)
      .map(([winKey, tabIds]) => {
        const wi = parseInt(winKey.slice(1));
        const origWin = session.windows[wi] ?? {};
        const tabs = tabIds
          .map((tabId, idx) => {
            const tab = tabMapRef.current[tabId];
            if (!tab) return null;
            const movedAcrossWindow = originalWindowOf[tabId] !== winKey;

            if (movedAcrossWindow) {
              // Cross-window move: always clear group
              return { ...tab, index: idx, groupId: -1, groupColor: undefined, groupTitle: undefined };
            }

            if (tabId === draggedTabId) {
              // Same-window drag: determine group by looking at both neighbors.
              // Inherit from the tab above if it's in a group; if above has no group
              // but the tab below does, join the group below (placed at group start).
              const aboveId = idx > 0 ? tabIds[idx - 1] : null;
              const belowId = idx < tabIds.length - 1 ? tabIds[idx + 1] : null;
              const above = aboveId ? tabMapRef.current[aboveId] : null;
              const below = belowId ? tabMapRef.current[belowId] : null;
              const srcGroup = above?.groupId && above.groupId !== -1 ? above : (below?.groupId && below.groupId !== -1 ? below : null);
              return {
                ...tab,
                index: idx,
                groupId: srcGroup?.groupId ?? -1,
                groupColor: srcGroup?.groupColor,
                groupTitle: srcGroup?.groupTitle,
              };
            }

            return { ...tab, index: idx };
          })
          .filter((t): t is Tab => t !== null);
        return { ...origWin, tabs };
      })
      .filter(w => w.tabs.length > 0);

    if (newWindows.length === 0) return;

    const updated: Session = {
      ...session,
      windows: newWindows,
      tabCount: newWindows.reduce((n, w) => n + w.tabs.length, 0),
      windowCount: newWindows.length,
    };

    pushUndo({ type: "session", sessionId: session.id, session: deepClone(session) });
    dispatch({ type: "SET_SELECTED_TABS", keys: new Set() });
    send({ type: "updateSession", session: updated })
      .then(() => { toast("Collection updated"); return onUpdate(); })
      .catch(() => toast("Failed to save"));
  }

  function mergeWindows(srcWi: number, dstWi: number) {
    const s: Session = { ...session, windows: deepClone(session.windows) };
    pushUndo({ type: "session", sessionId: s.id, session: deepClone(session) });

    const srcWin = s.windows[srcWi];
    s.windows.splice(srcWi, 1);
    const actualDst = srcWi < dstWi ? dstWi - 1 : dstWi;
    const dstWin = s.windows[actualDst];
    if (!srcWin || !dstWin) return;

    const offset = dstWin.tabs.length;
    srcWin.tabs.sort((a, b) => a.index - b.index).forEach(tab => {
      tab.index = offset + tab.index;
      tab.groupId = -1; tab.groupColor = undefined; tab.groupTitle = undefined;
      dstWin.tabs.push(tab);
    });
    s.tabCount = s.windows.reduce((n, w) => n + w.tabs.length, 0);
    s.windowCount = s.windows.length;

    send({ type: "updateSession", session: s })
      .then(() => { toast("Windows merged"); return onUpdate(); })
      .catch(() => toast("Failed to save"));
  }

  return (
    <DragStateCtx.Provider value={{ tabOrder, tabMap: tabMapRef.current }}>
      <DragDropProvider
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        {children}
        <DragOverlay dropAnimation={null}>
          {(source: any) => {
            if (source?.type === "item") {
              const tabId = source.id as string;
              const tab = tabMapRef.current[tabId];
              return (
                <div className="tab-row drag-overlay">
                  <span className="tab-title">{tab?.title || tab?.url || tabId}</span>
                </div>
              );
            }
            if (source?.type === "window") {
              const winKey = source.id as string;
              const wi = parseInt(winKey.slice(1));
              const win = session.windows[wi];
              return (
                <div className="window-header drag-overlay">
                  <span className="window-header-title">
                    {win?.name ?? `Window ${wi + 1}`}
                  </span>
                </div>
              );
            }
            return null;
          }}
        </DragOverlay>
      </DragDropProvider>
    </DragStateCtx.Provider>
  );
}
