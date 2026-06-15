import { useState, useEffect, useCallback } from "react";
import { useApp } from "../../context/AppContext";
import { send } from "../../utils/messaging";
import { formatDate, tabCountLabel } from "../../utils/helpers";

interface ClosedTab {
  id?: number;
  url: string;
  title: string;
  favIconUrl?: string;
  sessionId?: string;
}

interface ClosedWindow {
  sessionId?: string;
  tabs?: ClosedTab[];
}

interface ClosedItem {
  lastModified: number;
  tab?: ClosedTab;
  window?: ClosedWindow;
}

export function ClosedView() {
  const { toast } = useApp();
  const [items, setItems] = useState<ClosedItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchClosed = useCallback(async () => {
    setLoading(true);
    try {
      const data = await send({ type: "getRecentlyClosed" }).catch(() => []) as ClosedItem[];
      setItems(data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchClosed(); }, [fetchClosed]);

  async function restore(sessionId: string | undefined) {
    if (!sessionId) return;
    try {
      await send({ type: "restoreClosedSession", sessionId });
      toast("Restored");
      void fetchClosed();
    } catch {
      toast("Could not restore");
    }
  }

  const count = items.length;
  const sub = count ? `${count} item${count !== 1 ? "s" : ""}` : "Nothing recently closed";

  return (
    <>
      <div className="content-header">
        <div className="content-header-info">
          <div className="content-header-title">Recently closed</div>
          <div className="content-header-sub">{loading ? "" : sub}</div>
        </div>
        <div className="content-header-buttons" />
      </div>

      <div className="content-area">
        {loading ? (
          <div className="empty-state"><p>Loading…</p></div>
        ) : count === 0 ? (
          <div className="empty-state"><p>No recently closed tabs or windows</p></div>
        ) : (
          items.map((item, idx) => {
            if (item.tab) {
              const tab = item.tab;
              return (
                <div key={idx} className="closed-item">
                  {tab.favIconUrl ? (
                    <img
                      className="closed-favicon"
                      src={tab.favIconUrl}
                      onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                      alt=""
                    />
                  ) : null}
                  <div className="closed-item-text">
                    <div className="closed-item-title">{tab.title || tab.url}</div>
                    <div className="closed-item-url">{tab.url}</div>
                  </div>
                  <span className="closed-item-time">{formatDate(item.lastModified * 1000)}</span>
                  <button
                    className="btn btn-ghost closed-restore-btn"
                    onClick={() => void restore(tab.sessionId)}
                  >
                    Restore
                  </button>
                </div>
              );
            }

            if (item.window) {
              const win = item.window;
              const tabCount = win.tabs?.length ?? 0;
              return (
                <div key={idx} className="closed-window-block">
                  <div className="closed-window-header">
                    <svg viewBox="0 0 16 16" fill="none" className="closed-window-icon">
                      <rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.2"/>
                      <line x1="1" y1="6" x2="15" y2="6" stroke="currentColor" strokeWidth="1.2"/>
                    </svg>
                    <span className="closed-window-title">Window — {tabCountLabel(tabCount)}</span>
                    <span className="closed-item-time">{formatDate(item.lastModified * 1000)}</span>
                    <button
                      className="btn btn-ghost closed-restore-btn"
                      onClick={() => void restore(win.sessionId)}
                    >
                      Restore
                    </button>
                  </div>
                  <div className="closed-window-tabs">
                    {(win.tabs || []).slice(0, 8).map((tab, ti) => (
                      <div key={ti} className="closed-item closed-item-indent">
                        <div className="closed-item-text">
                          <div className="closed-item-title">{tab.title || tab.url || ""}</div>
                          <div className="closed-item-url">{tab.url || ""}</div>
                        </div>
                      </div>
                    ))}
                    {(win.tabs?.length ?? 0) > 8 && (
                      <div className="closed-item-more">
                        + {(win.tabs?.length ?? 0) - 8} more tabs
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            return null;
          })
        )}
      </div>
    </>
  );
}
