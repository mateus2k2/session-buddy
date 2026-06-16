import { useState, useRef, useEffect } from "react";
import {
  DndContext, DragEndEvent, DragOverlay, PointerSensor,
  useSensor, useSensors, closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy,
  useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useApp } from "../../context/AppContext";
import { send } from "../../utils/messaging";
import { tabCountLabel, deepClone, esc } from "../../utils/helpers";
import type { Session } from "../../context/types";

interface SidebarCounts {
  tabs: number | null;
  history: number | null;
  closed: number | null;
}

interface Props {
  onLoadSessions: () => Promise<void>;
  counts: SidebarCounts;
}

// ─── Context menu ────────────────────────────────────────────────────────────

interface CtxMenuState {
  session: Session;
  x: number;
  y: number;
}

function ContextMenu({ session, x, y, onClose, onRename, onDelete }: {
  session: Session; x: number; y: number;
  onClose: () => void; onRename: () => void; onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onClose]);

  // Flip if off-screen
  const style: React.CSSProperties = { position: "fixed", left: x, top: y, zIndex: 9999 };

  return (
    <div ref={ref} className="ctx-menu" style={style}>
      <div className="ctx-menu-item" onClick={() => { onClose(); onRename(); }}>Rename</div>
      <div className="ctx-menu-sep" />
      <div className="ctx-menu-item danger" onClick={() => { onClose(); onDelete(); }}>Delete</div>
    </div>
  );
}

// ─── Sortable session item ───────────────────────────────────────────────────

function SortableSessionItem({
  session, isActive, isSelected, isCurrentView, query,
  onClick, onContextMenu, onPencilClick,
}: {
  session: Session; isActive: boolean; isSelected: boolean; isCurrentView: boolean; query: string;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onPencilClick: (e: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: session.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const total = session.tabCount ?? session.windows.reduce((s, w) => s + w.tabs.length, 0);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`session-nav-item${isCurrentView ? " active" : ""}${isSelected ? " sel" : ""}`}
      data-session-id={session.id}
      onClick={onClick}
      onContextMenu={onContextMenu}
      {...attributes}
      {...listeners}
    >
      <svg viewBox="0 0 16 16" fill="none">
        <rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.2"/>
        <line x1="1" y1="6" x2="15" y2="6" stroke="currentColor" strokeWidth="1.2"/>
      </svg>
      <div className="session-nav-text">
        <div className="session-nav-name" title={session.name}>{session.name}</div>
        <div className="session-nav-meta">{tabCountLabel(total)}</div>
      </div>
      <button
        className="session-nav-pencil"
        title="Rename or delete"
        onClick={e => { e.stopPropagation(); onPencilClick(e); }}
        onPointerDown={e => e.stopPropagation()}
      >
        <svg viewBox="0 0 16 16" fill="none" width="13" height="13">
          <path d="M11 2.5a1.5 1.5 0 0 1 2.12 0l.38.38a1.5 1.5 0 0 1 0 2.12L5 13.5 2 14l.5-3L11 2.5Z"
            stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  );
}

// ─── Main Sidebar ────────────────────────────────────────────────────────────

export function Sidebar({ onLoadSessions, counts }: Props) {
  const { state, dispatch, toast, showModal, hideModal, pushUndo } = useApp();
  const { view, sessions, selectedSessionIds } = state;

  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  function setView(v: string) {
    dispatch({ type: "SET_VIEW", view: v });
  }

  function sidebarItemClass(id: string) {
    return `sidebar-item${view === id ? " active" : ""}`;
  }

  // ─── Session selection ──────────────────────────────────────────────────────

  function handleSessionClick(e: React.MouseEvent, session: Session, sessionIds: string[]) {
    if (e.shiftKey && state.lastSessionId) {
      const a = sessionIds.indexOf(state.lastSessionId);
      const b = sessionIds.indexOf(session.id);
      const [from, to] = a < b ? [a, b] : [b, a];
      const newIds = new Set(selectedSessionIds);
      for (let i = from; i <= to; i++) newIds.add(sessionIds[i]!);
      dispatch({ type: "SET_SELECTED_SESSIONS", ids: newIds });
    } else if (e.ctrlKey || e.metaKey) {
      const newIds = new Set(selectedSessionIds);
      if (newIds.has(session.id)) newIds.delete(session.id);
      else newIds.add(session.id);
      dispatch({ type: "SET_SELECTED_SESSIONS", ids: newIds });
      dispatch({ type: "SET_LAST_SESSION_ID", id: session.id });
    } else {
      dispatch({ type: "SET_SELECTED_SESSIONS", ids: new Set() });
      dispatch({ type: "SET_LAST_SESSION_ID", id: session.id });
      setView(session.id);
    }
  }

  // ─── Bulk delete ─────────────────────────────────────────────────────────

  async function deleteBulk() {
    const ids = [...selectedSessionIds];
    const toDelete = sessions.filter(s => ids.includes(s.id));
    pushUndo({ type: "delete", sessions: toDelete.map(s => deepClone(s)), oldOrder: sessions.map(s => s.id) });
    for (const id of ids) await send({ type: "deleteSession", id });
    toast(`Deleted ${ids.length} collection${ids.length !== 1 ? "s" : ""}`, undefined);
    dispatch({ type: "SET_SELECTED_SESSIONS", ids: new Set() });
    if (ids.includes(view)) dispatch({ type: "SET_VIEW", view: "current" });
    await onLoadSessions();
  }

  // ─── Context menu actions ─────────────────────────────────────────────────

  function showRenameModal(session: Session) {
    showModal(
      "Rename collection",
      `<input type="text" id="rename-input" value="${esc(session.name)}" placeholder="Collection name" />`,
      [
        { label: "Cancel", cls: "btn-ghost", action: hideModal },
        {
          label: "Rename", cls: "btn-primary", action: async () => {
            const name = (document.getElementById("rename-input") as HTMLInputElement).value.trim();
            if (!name) return;
            pushUndo({ type: "rename", sessionId: session.id, oldName: session.name });
            hideModal();
            await send({ type: "renameSession", id: session.id, name });
            toast("Renamed", undefined);
            await onLoadSessions();
          }
        },
      ]
    );
  }

  function showDeleteModal(session: Session) {
    showModal(
      "Delete collection",
      `<p>Delete "<strong>${esc(session.name)}</strong>"?</p>`,
      [
        { label: "Cancel", cls: "btn-ghost", action: hideModal },
        {
          label: "Delete", cls: "btn-danger", action: async () => {
            pushUndo({ type: "delete", sessions: [deepClone(session)], oldOrder: sessions.map(s => s.id) });
            hideModal();
            await send({ type: "deleteSession", id: session.id });
            toast("Collection deleted", undefined);
            if (view === session.id) dispatch({ type: "SET_VIEW", view: "current" });
            await onLoadSessions();
          }
        },
      ]
    );
  }

  // ─── Drag and drop (reorder) ──────────────────────────────────────────────

  function onDragEnd({ active, over }: DragEndEvent) {
    setActiveDragId(null);
    if (!over || active.id === over.id) return;
    const oldIndex = sessions.findIndex(s => s.id === active.id);
    const newIndex = sessions.findIndex(s => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(sessions, oldIndex, newIndex);
    pushUndo({ type: "reorder", oldOrder: sessions.map(s => s.id) });
    dispatch({ type: "SET_SESSIONS", sessions: reordered });
    send({ type: "reorderSessions", order: reordered.map(s => s.id) }).catch(() => toast("Failed to save order"));
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  const sessionIds = sessions.map(s => s.id);
  const query = state.searchQuery.toLowerCase();
  const filtered = query
    ? sessions.filter(s =>
        s.name.toLowerCase().includes(query) ||
        s.windows.some(w => w.tabs.some(t =>
          t.title?.toLowerCase().includes(query) || t.url?.toLowerCase().includes(query)
        ))
      )
    : sessions;

  const activeSession = activeDragId ? sessions.find(s => s.id === activeDragId) : null;

  return (
    <aside className="sidebar">
      {ctxMenu && (
        <ContextMenu
          session={ctxMenu.session}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          onRename={() => showRenameModal(ctxMenu.session)}
          onDelete={() => showDeleteModal(ctxMenu.session)}
        />
      )}

      <section className="sidebar-section">
        <div className="sidebar-label">TABS</div>

        <div className={sidebarItemClass("history")} onClick={() => setView("history")}>
          <svg className="sidebar-item-icon" viewBox="0 0 24 24" fill="none">
            <path d="M12 7V12L14.5 10.5M21 12C21 16.97 16.97 21 12 21C7.03 21 3 16.97 3 12C3 7.03 7.03 3 12 3C16.97 3 21 7.03 21 12Z" stroke="#9a9a9a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <div className="sidebar-item-text">
            <div className="sidebar-item-title">History</div>
            <div className="sidebar-item-sub" id="history-sidebar-sub">
              {counts.history === null ? "— entries" : `${counts.history} entr${counts.history !== 1 ? "ies" : "y"}`}
            </div>
          </div>
        </div>

        <div className={sidebarItemClass("closed")} onClick={() => setView("closed")}>
          <svg className="sidebar-item-icon" viewBox="0 0 24 24" fill="none">
            <path d="M12 7V12L14.5 10.5M21 12C21 16.97 16.97 21 12 21C7.03 21 3 16.97 3 12C3 7.03 7.03 3 12 3C16.97 3 21 7.03 21 12Z" stroke="#9a9a9a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <div className="sidebar-item-text">
            <div className="sidebar-item-title">Recently closed</div>
            <div className="sidebar-item-sub" id="closed-sidebar-sub">
              {counts.closed === null ? "— items" : `${counts.closed} item${counts.closed !== 1 ? "s" : ""}`}
            </div>
          </div>
        </div>

        <div className={sidebarItemClass("current")} onClick={() => setView("current")}>
          <svg className="sidebar-item-icon" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="8" stroke="#e8a020" strokeWidth="1.8"/>
            <line x1="10" y1="2" x2="10" y2="18" stroke="#e8a020" strokeWidth="1.4"/>
            <path d="M2 10 Q6 6 10 10 Q14 14 18 10" stroke="#e8a020" strokeWidth="1.4" fill="none"/>
          </svg>
          <div className="sidebar-item-text">
            <div className="sidebar-item-title">This browser</div>
            <div className="sidebar-item-sub" id="current-tab-count">
              {counts.tabs === null ? "— tabs" : `${counts.tabs} tab${counts.tabs !== 1 ? "s" : ""}`}
            </div>
          </div>
        </div>
      </section>

      <section className="sidebar-section">
        <div className="sidebar-label">COOKIES</div>
        <div className={sidebarItemClass("cookies")} onClick={() => setView("cookies")}>
          <svg className="sidebar-item-icon" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="8" stroke="#9a6dd7" strokeWidth="1.8"/>
            <circle cx="7"  cy="8"  r="1.2" fill="#9a6dd7"/>
            <circle cx="13" cy="8"  r="1.2" fill="#9a6dd7"/>
            <circle cx="10" cy="13" r="1.2" fill="#9a6dd7"/>
            <circle cx="7"  cy="13" r="0.8" fill="#9a6dd7"/>
            <circle cx="13" cy="13" r="0.8" fill="#9a6dd7"/>
          </svg>
          <div className="sidebar-item-text">
            <div className="sidebar-item-title">Private window</div>
            <div className="sidebar-item-sub" id="cookie-sidebar-sub">cookies</div>
          </div>
        </div>
      </section>

      <section className="sidebar-section">
        <div className="sidebar-label">COLLECTIONS</div>
        <div id="sessions-list" className="sessions-nav">
          {filtered.length === 0 && (
            <div className="no-collections">
              <svg viewBox="0 0 40 40" fill="none">
                <rect x="6" y="8" width="28" height="24" rx="3" stroke="#555" strokeWidth="1.5"/>
                <line x1="13" y1="14" x2="27" y2="14" stroke="#555" strokeWidth="1.5"/>
                <line x1="13" y1="20" x2="22" y2="20" stroke="#555" strokeWidth="1.5"/>
              </svg>
              <div className="no-collections-title">No collections</div>
              <div className="no-collections-sub">Save tabs to create a collection</div>
            </div>
          )}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={({ active }) => setActiveDragId(active.id.toString())}
            onDragEnd={onDragEnd}
            onDragCancel={() => setActiveDragId(null)}
          >
            <SortableContext items={sessionIds} strategy={verticalListSortingStrategy}>
              {filtered.map(session => (
                <SortableSessionItem
                  key={session.id}
                  session={session}
                  isActive={activeDragId === session.id}
                  isSelected={selectedSessionIds.has(session.id)}
                  isCurrentView={view === session.id}
                  query={query}
                  onClick={e => handleSessionClick(e, session, sessionIds)}
                  onContextMenu={e => {
                    e.preventDefault();
                    setCtxMenu({ session, x: e.clientX, y: e.clientY });
                  }}
                  onPencilClick={e => setCtxMenu({ session, x: e.clientX, y: e.clientY })}
                />
              ))}
            </SortableContext>

            <DragOverlay dropAnimation={null}>
              {activeSession && (
                <div className="session-nav-item active" style={{ opacity: 0.85, boxShadow: "0 4px 12px rgba(0,0,0,0.4)" }}>
                  <svg viewBox="0 0 16 16" fill="none">
                    <rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.2"/>
                    <line x1="1" y1="6" x2="15" y2="6" stroke="currentColor" strokeWidth="1.2"/>
                  </svg>
                  <div className="session-nav-text">
                    <div className="session-nav-name">{activeSession.name}</div>
                    <div className="session-nav-meta">{tabCountLabel(activeSession.tabCount ?? 0)}</div>
                  </div>
                </div>
              )}
            </DragOverlay>
          </DndContext>
        </div>

        {selectedSessionIds.size > 0 && (
          <div className="sidebar-sel-bar">
            <span className="sidebar-sel-count">{selectedSessionIds.size} selected</span>
            <button className="sidebar-sel-del" onClick={() => void deleteBulk()}>Delete</button>
          </div>
        )}
      </section>
    </aside>
  );
}
