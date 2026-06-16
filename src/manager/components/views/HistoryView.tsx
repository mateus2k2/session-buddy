import { useState, useEffect, useCallback } from "react";
import { useApp } from "../../context/AppContext";
import { send } from "../../utils/messaging";
import { formatHistoryDate, formatHistoryTime, historyTypeLabel, tabCountLabel } from "../../utils/helpers";
import { WindowBlock } from "./WindowBlock";
import type { HistoryEntry } from "../../context/types";

interface Props {
  onLoadSessions: () => Promise<void>;
}

function HistoryEntryItem({
  entry,
  onDelete,
  onLoadSessions,
}: {
  entry: HistoryEntry;
  onDelete: (id: string) => void;
  onLoadSessions: () => Promise<void>;
}) {
  const { showModal, hideModal, toast } = useApp();
  const [open, setOpen] = useState(false);

  const tabWord = `${entry.tabCount} tab${entry.tabCount !== 1 ? "s" : ""}`;
  const winWord = `${entry.windowCount} window${entry.windowCount !== 1 ? "s" : ""}`;

  function handleSaveAs() {
    const defaultName = `${formatHistoryDate(entry.date)} ${formatHistoryTime(entry.date)}`;
    showModal(
      "Save as collection",
      `<input type="text" id="history-save-input" value="${defaultName.replace(/"/g, "&quot;")}" placeholder="Collection name" />`,
      [
        { label: "Cancel", cls: "btn-ghost", action: hideModal },
        {
          label: "Save", cls: "btn-primary", action: async () => {
            const input = document.getElementById("history-save-input") as HTMLInputElement;
            const name = input.value.trim() || defaultName;
            hideModal();
            await send({ type: "saveHistoryAsSession", entry, name });
            toast("Saved as collection");
            await onLoadSessions();
          }
        },
      ]
    );
  }

  function handleDelete() {
    showModal(
      "Delete entry",
      `<p>Remove this history entry from ${formatHistoryTime(entry.date)}?</p>`,
      [
        { label: "Cancel", cls: "btn-ghost", action: hideModal },
        {
          label: "Delete", cls: "btn-danger", action: async () => {
            hideModal();
            await send({ type: "deleteHistoryEntry", id: entry.id });
            onDelete(entry.id);
          }
        },
      ]
    );
  }

  return (
    <div className={`history-entry${open ? " open" : ""}`}>
      <div className="history-entry-header" onClick={() => setOpen(o => !o)}>
        <div className="history-entry-dot" />
        <div className="history-entry-info">
          <div className="history-entry-time">{formatHistoryTime(entry.date)}</div>
          <div className="history-entry-type">{historyTypeLabel(entry.type)}</div>
          <div className="history-entry-meta">{winWord} · {tabWord}</div>
        </div>
        <span className="history-entry-arrow">▶</span>
      </div>

      {open && (
        <div className="history-entry-body">
          <div className="history-entry-windows">
            {entry.windows.map((win, i) => (
              <WindowBlock
                key={i}
                win={win}
                winIdx={i}
                winKey={`w${i}`}
                totalWindows={entry.windows.length}
                query=""
                selectable={false}
                treeEnabled={false}
              />
            ))}
          </div>
          <div className="history-entry-actions">
            <button className="btn btn-primary" onClick={e => { e.stopPropagation(); handleSaveAs(); }}>
              Save as collection
            </button>
            <button
              className="btn btn-ghost"
              onClick={e => {
                e.stopPropagation();
                void send({ type: "openHistoryEntry", entry, mode: "newWindow" });
              }}
            >
              Open in new window
            </button>
            <button
              className="btn btn-ghost"
              style={{ marginLeft: "auto" }}
              onClick={e => { e.stopPropagation(); handleDelete(); }}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function HistoryView({ onLoadSessions }: Props) {
  const { showModal, hideModal } = useApp();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const data = await send({ type: "getHistory" }) as HistoryEntry[];
      setEntries(data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchHistory(); }, [fetchHistory]);

  function handleDelete(id: string) {
    setEntries(prev => prev.filter(e => e.id !== id));
  }

  function handleClearAll() {
    showModal(
      "Clear history",
      "<p>Delete all history entries? This cannot be undone.</p>",
      [
        { label: "Cancel", cls: "btn-ghost", action: hideModal },
        {
          label: "Clear All", cls: "btn-danger", action: async () => {
            hideModal();
            await send({ type: "clearHistory" });
            setEntries([]);
          }
        },
      ]
    );
  }

  // Group by date label
  const groups: Record<string, HistoryEntry[]> = {};
  for (const e of entries) {
    const label = formatHistoryDate(e.date);
    (groups[label] = groups[label] || []).push(e);
  }

  const countLabel = `${entries.length} entr${entries.length !== 1 ? "ies" : "y"}`;

  return (
    <>
      <div className="content-header">
        <div className="content-header-info">
          <div className="content-header-title">History</div>
          <div className="content-header-sub">{loading ? "" : countLabel}</div>
        </div>
        <div className="content-header-buttons">
          {!loading && entries.length > 0 && (
            <button className="btn btn-ghost" onClick={handleClearAll}>
              Clear history
            </button>
          )}
        </div>
      </div>

      <div className="content-area">
        {loading ? (
          <div className="empty-state"><p>Loading…</p></div>
        ) : entries.length === 0 ? (
          <div className="empty-state">
            <p>No history yet — history saves automatically when the browser closes</p>
          </div>
        ) : (
          <>
            <div className="history-timeline">
              <div className="history-entry now">
                <div className="history-entry-dot" />
                <div className="history-entry-time">Now</div>
              </div>
            </div>

            {Object.entries(groups).map(([dateLabel, dayEntries]) => (
              <div key={dateLabel}>
                <div style={{
                  fontSize: "11px", fontWeight: 600, color: "var(--text-sec)",
                  textTransform: "uppercase", letterSpacing: "0.06em",
                  padding: "12px 0 4px 0",
                }}>
                  {dateLabel}
                </div>
                <div className="history-timeline">
                  {dayEntries.map(entry => (
                    <HistoryEntryItem
                      key={entry.id}
                      entry={entry}
                      onDelete={handleDelete}
                      onLoadSessions={onLoadSessions}
                    />
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}
