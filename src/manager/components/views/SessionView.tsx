import { useEffect, useRef } from "react";
import { useApp } from "../../context/AppContext";
import { send } from "../../utils/messaging";
import { formatDate, tabCountLabel, deepClone, esc } from "../../utils/helpers";
import { exportSessionAsJson, exportSessionAsText } from "../../utils/download";
import { SessionDnD } from "../dnd/SessionDnD";
import { WindowBlock } from "./WindowBlock";
import type { Session, TabRenderEntry } from "../../context/types";

interface Props {
  session: Session;
  onLoadSessions: () => Promise<void>;
}

interface DropdownItem {
  label?: string;
  action?: () => void;
  danger?: boolean;
  separator?: boolean;
}

function DropdownButton({ label, items, cls = "btn-ghost" }: { label: string; items: DropdownItem[]; cls?: string }) {
  const menuRef = useRef<HTMLDivElement>(null);

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    const menu = menuRef.current;
    if (!menu) return;
    document.querySelectorAll(".dropdown-menu.open").forEach(m => m !== menu && m.classList.remove("open","align-left","flip-up"));
    const wasOpen = menu.classList.contains("open");
    menu.classList.remove("open","align-left","flip-up");
    if (!wasOpen) {
      menu.classList.add("open");
      const rect = menu.getBoundingClientRect();
      if (rect.left < 0) menu.classList.add("align-left");
      if (rect.bottom > window.innerHeight) menu.classList.add("flip-up");
    }
  }

  return (
    <div className="btn-dropdown">
      <button className={`btn ${cls}`} onClick={toggle}>{label}</button>
      <div className="dropdown-menu" ref={menuRef}>
        {items.map((item, i) =>
          item.separator ? (
            <div key={i} className="dropdown-separator" />
          ) : (
            <div
              key={i}
              className={`dropdown-item${item.danger ? " danger" : ""}`}
              onClick={() => { menuRef.current?.classList.remove("open"); item.action?.(); }}
            >
              {item.label}
            </div>
          )
        )}
      </div>
    </div>
  );
}

export function SessionView({ session, onLoadSessions }: Props) {
  const { state, dispatch, showModal, hideModal, toast, pushUndo } = useApp();

  const total = session.windows.reduce((s, w) => s + w.tabs.length, 0);

  // Build tabRenderOrder from session (no race condition)
  useEffect(() => {
    const order: TabRenderEntry[] = [];
    session.windows.forEach((win, wi) => {
      [...win.tabs].sort((a, b) => a.index - b.index).forEach((tab, ti) => {
        order.push({ key: `${wi}:${ti}`, tab });
      });
    });
    dispatch({ type: "SET_TAB_RENDER_ORDER", order });
    dispatch({ type: "SET_SELECTED_TABS", keys: new Set() });
  }, [session, dispatch]);

  // Close dropdowns on outside click
  useEffect(() => {
    function close(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest(".btn-dropdown")) {
        document.querySelectorAll(".dropdown-menu.open").forEach(m => m.classList.remove("open"));
      }
    }
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  async function openSession(mode: string) {
    await send({ type: "openSession", id: session.id, mode });
  }

  function showRenameModal() {
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

  function showDeleteModal() {
    showModal(
      "Delete collection",
      `<p>Delete "<strong>${esc(session.name)}</strong>"?</p>`,
      [
        { label: "Cancel", cls: "btn-ghost", action: hideModal },
        {
          label: "Delete", cls: "btn-danger", action: async () => {
            pushUndo({ type: "delete", sessions: [deepClone(session)], oldOrder: [] });
            hideModal();
            await send({ type: "deleteSession", id: session.id });
            toast("Collection deleted", undefined);
            dispatch({ type: "SET_VIEW", view: "current" });
            await onLoadSessions();
          }
        },
      ]
    );
  }

  function showReplaceModal() {
    showModal(
      "Replace collection",
      `<p>Overwrite "<strong>${esc(session.name)}</strong>" with all currently open tabs?</p>`,
      [
        { label: "Cancel", cls: "btn-ghost", action: hideModal },
        {
          label: "Replace", cls: "btn-danger", action: async () => {
            hideModal();
            await send({ type: "replaceSession", id: session.id });
            toast("Collection replaced");
            await onLoadSessions();
          }
        },
      ]
    );
  }

  async function duplicateSession() {
    const copy: Session = { ...deepClone(session), id: genId(), name: `${session.name} (copy)`, date: Date.now() };
    await send({ type: "importSessions", sessions: [copy] });
    toast("Duplicated");
    await onLoadSessions();
  }

  return (
    <SessionDnD session={session} onUpdate={onLoadSessions}>
      <div className="content-header">
        <div className="content-header-info">
          <div className="content-header-title">{session.name}</div>
          <div className="content-header-sub">
            {formatDate(session.date)} · {tabCountLabel(total)} · {session.windows.length === 1 ? "1 window" : `${session.windows.length} windows`}
          </div>
        </div>
        <div className="content-header-buttons">
          <DropdownButton label="Open" cls="btn-primary" items={[
            { label: "Open in new window",     action: () => void openSession("newWindow") },
            { label: "Open in current window", action: () => void openSession("currentWindow") },
          ]} />
          <DropdownButton label="Export" items={[
            { label: "Export as JSON", action: () => exportSessionAsJson(session) },
            { label: "Export as text", action: () => exportSessionAsText(session) },
          ]} />
          <DropdownButton label="⋯" items={[
            { label: "Rename",    action: showRenameModal },
            { label: "Duplicate", action: () => void duplicateSession() },
            { label: "Replace with current browser", action: showReplaceModal },
            { separator: true },
            { label: "Delete", action: showDeleteModal, danger: true },
          ]} />
        </div>
      </div>

      <div className="content-area">
        {session.windows.map((win, i) => (
          <WindowBlock
            key={`${session.id}-w${i}`}
            win={win}
            winIdx={i}
            winKey={`w${i}`}
            totalWindows={session.windows.length}
            query={state.searchQuery.toLowerCase()}
            selectable
            editSession={session}
            onSessionUpdate={onLoadSessions}
          />
        ))}
      </div>
    </SessionDnD>
  );
}
