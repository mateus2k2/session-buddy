import { useEffect, useCallback, useState } from "react";
import { useApp } from "./context/AppContext";
import { send } from "./utils/messaging";
import { useUndo } from "./hooks/useUndo";
import { parseTextImport } from "./utils/import";
import { exportBackup } from "./utils/download";
import { esc, deepClone } from "./utils/helpers";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { SessionView } from "./components/views/SessionView";
import { CurrentView } from "./components/views/CurrentView";
import { HistoryView } from "./components/views/HistoryView";
import { ClosedView } from "./components/views/ClosedView";
import { CookieView } from "./components/views/CookieView";
import { Toast } from "./components/shared/Toast";
import { Modal } from "./components/shared/Modal";
import { SelectionBar } from "./components/shared/SelectionBar";
import type { Session } from "./context/types";

interface SidebarCounts {
  tabs: number | null;
  history: number | null;
  closed: number | null;
}

export function App() {
  const { state, dispatch, showModal, hideModal, toast, pushUndo } = useApp();
  const { undo, redo } = useUndo();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [counts, setCounts] = useState<SidebarCounts>({ tabs: null, history: null, closed: null });

  const loadSessions = useCallback(async () => {
    const sessions: Session[] = await send({ type: "getSessions" });
    dispatch({ type: "SET_SESSIONS", sessions });
  }, [dispatch]);

  const loadSidebarCounts = useCallback(async () => {
    try {
      const [cur, hist, closed] = await Promise.all([
        send({ type: "getCurrentState" }) as Promise<{ tabCount?: number; windows: { tabs: unknown[] }[] }>,
        send({ type: "getHistory" }) as Promise<unknown[]>,
        send({ type: "getRecentlyClosed" }) as Promise<unknown[]>,
      ]);
      const tabsTotal = cur?.tabCount ?? cur?.windows?.reduce((n: number, w) => n + w.tabs.length, 0) ?? 0;
      setCounts({ tabs: tabsTotal, history: hist?.length ?? 0, closed: closed?.length ?? 0 });
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { void loadSessions(); void loadSidebarCounts(); }, [loadSessions, loadSidebarCounts]);

  // Keyboard shortcuts
  useEffect(() => {
    async function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (state.modalOpen) { hideModal(); return; }
        if (state.selectedTabKeys.size > 0) { dispatch({ type: "SET_SELECTED_TABS", keys: new Set() }); return; }
        if (state.selectedSessionIds.size > 0) { dispatch({ type: "SET_SELECTED_SESSIONS", ids: new Set() }); return; }
        return;
      }
      if (state.modalOpen) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); await undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === "y") { e.preventDefault(); await redo(); return; }

      const session = state.sessions.find(s => s.id === state.view) ?? null;
      const hasTabSel = state.selectedTabKeys.size > 0;

      // ── Session view shortcuts ──────────────────────────────────────────────
      if (session) {
        // Ctrl+A — select all tabs in current session
        if ((e.ctrlKey || e.metaKey) && e.key === "a") {
          e.preventDefault();
          const allKeys = new Set<string>();
          session.windows.forEach((win, wi) =>
            win.tabs.forEach((_, ti) => allKeys.add(`${wi}:${ti}`))
          );
          dispatch({ type: "SET_SELECTED_TABS", keys: allKeys });
          return;
        }

        // Ctrl+C — copy URLs of selected tabs
        if ((e.ctrlKey || e.metaKey) && e.key === "c" && hasTabSel) {
          e.preventDefault();
          const urls: string[] = [];
          session.windows.forEach((win, wi) =>
            [...win.tabs].sort((a, b) => a.index - b.index).forEach((tab, ti) => {
              if (state.selectedTabKeys.has(`${wi}:${ti}`)) urls.push(tab.url);
            })
          );
          await navigator.clipboard.writeText(urls.join("\n"));
          toast("URLs copied");
          return;
        }

        // F2 — rename session
        if (e.key === "F2") {
          e.preventDefault();
          showModal(
            "Rename collection",
            `<input type="text" id="kb-rename-input" value="${esc(session.name)}" placeholder="Collection name" />`,
            [
              { label: "Cancel", cls: "btn-ghost", action: hideModal },
              {
                label: "Rename", cls: "btn-primary", action: async () => {
                  const name = (document.getElementById("kb-rename-input") as HTMLInputElement).value.trim();
                  if (!name) return;
                  pushUndo({ type: "rename", sessionId: session.id, oldName: session.name });
                  hideModal();
                  await send({ type: "renameSession", id: session.id, name });
                  toast("Renamed");
                  await loadSessions();
                }
              },
            ]
          );
          return;
        }

        // Delete — remove selected tabs (if any), otherwise delete the whole session
        if (e.key === "Delete") {
          e.preventDefault();
          if (hasTabSel) {
            // Remove selected tabs from session
            pushUndo({ type: "session", sessionId: session.id, session: deepClone(session) });
            const toRemove = new Set(state.selectedTabKeys);
            const newWindows = session.windows.map((win, wi) => {
              const sorted = [...win.tabs].sort((a, b) => a.index - b.index);
              const kept = sorted.filter((_, ti) => !toRemove.has(`${wi}:${ti}`));
              kept.forEach((t, i) => { t.index = i; });
              return { ...win, tabs: kept };
            }).filter(w => w.tabs.length > 0);
            dispatch({ type: "SET_SELECTED_TABS", keys: new Set() });
            if (newWindows.length === 0) {
              await send({ type: "deleteSession", id: session.id });
              toast("Session deleted");
              dispatch({ type: "SET_VIEW", view: "current" });
              await loadSessions();
            } else {
              const updated = { ...session, windows: newWindows, tabCount: newWindows.reduce((n, w) => n + w.tabs.length, 0), windowCount: newWindows.length };
              await send({ type: "updateSession", session: updated });
              dispatch({ type: "SET_SESSIONS", sessions: state.sessions.map(s => s.id === updated.id ? updated : s) });
              toast("Removed from collection");
            }
          } else {
            // Confirm-delete the whole session
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
                    toast("Collection deleted");
                    dispatch({ type: "SET_VIEW", view: "current" });
                    await loadSessions();
                  }
                },
              ]
            );
          }
          return;
        }

        // Enter — open session in a new window (no modifier, no selection)
        if (e.key === "Enter" && !hasTabSel && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
          e.preventDefault();
          await send({ type: "openSession", id: session.id, mode: "newWindow" });
          return;
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [state, dispatch, showModal, hideModal, toast, pushUndo, loadSessions, undo, redo]);

  // Wire up hidden file inputs
  useEffect(() => {
    const jsonInput = document.getElementById("import-json-input") as HTMLInputElement | null;
    const textInput = document.getElementById("import-text-input") as HTMLInputElement | null;
    const backupInput = document.getElementById("import-backup-input") as HTMLInputElement | null;

    async function onJsonChange(e: Event) {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      (e.target as HTMLInputElement).value = "";
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const sessions = Array.isArray(data) ? data : [data];
        if (!sessions.length) throw new Error("empty");
        if (sessions.length === 1) {
          const defaultName = sessions[0].name || file.name.replace(/\.json$/i, "");
          showModal(
            "Name this collection",
            `<input type="text" id="import-name-input" value="${esc(defaultName)}" placeholder="Collection name" />`,
            [
              { label: "Cancel", cls: "btn-ghost", action: hideModal },
              {
                label: "Import", cls: "btn-primary", action: async () => {
                  const name = (document.getElementById("import-name-input") as HTMLInputElement).value.trim() || defaultName;
                  sessions[0].name = name;
                  hideModal();
                  await send({ type: "importSessions", sessions });
                  toast("Imported 1 collection");
                  await loadSessions();
                }
              },
            ]
          );
        } else {
          const result = await send({ type: "importSessions", sessions }) as { count: number };
          toast(`Imported ${result.count} collections`);
          await loadSessions();
        }
      } catch {
        toast("Import failed — invalid JSON file");
      }
    }

    async function onTextChange(e: Event) {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      (e.target as HTMLInputElement).value = "";
      try {
        const text = await file.text();
        const sessions = parseTextImport(text);
        if (!sessions.length) throw new Error("no sessions found");
        if (sessions.length === 1) {
          const defaultName = sessions[0].name || file.name.replace(/\.txt$/i, "");
          showModal(
            "Name this collection",
            `<input type="text" id="import-name-input" value="${esc(defaultName)}" placeholder="Collection name" />`,
            [
              { label: "Cancel", cls: "btn-ghost", action: hideModal },
              {
                label: "Import", cls: "btn-primary", action: async () => {
                  const name = (document.getElementById("import-name-input") as HTMLInputElement).value.trim() || defaultName;
                  sessions[0].name = name;
                  hideModal();
                  await send({ type: "importSessions", sessions });
                  toast("Imported 1 collection");
                  await loadSessions();
                }
              },
            ]
          );
        } else {
          const result = await send({ type: "importSessions", sessions }) as { count: number };
          toast(`Imported ${result.count} collections`);
          await loadSessions();
        }
      } catch {
        toast("Import failed — check text file format");
      }
    }

    async function onBackupChange(e: Event) {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      (e.target as HTMLInputElement).value = "";
      try {
        const text = await file.text();
        const backup = JSON.parse(text);
        await send({ type: "importBackup", ...backup, merge: false });
        toast("Backup restored");
        await loadSessions();
      } catch {
        toast("Restore failed — invalid backup file");
      }
    }

    jsonInput?.addEventListener("change", onJsonChange);
    textInput?.addEventListener("change", onTextChange);
    backupInput?.addEventListener("change", onBackupChange);

    return () => {
      jsonInput?.removeEventListener("change", onJsonChange);
      textInput?.removeEventListener("change", onTextChange);
      backupInput?.removeEventListener("change", onBackupChange);
    };
  }, [loadSessions, toast]);

  async function openSettings() {
    const cfg = await send({ type: "getConfig" }) as { historyInterval?: number; historyLimit?: number; ignoreExtensionTabs?: boolean; ifSupportTst?: boolean; tstDelay?: number };
    const interval = cfg?.historyInterval ?? 5;
    const limit = cfg?.historyLimit ?? 50;
    const ignoreExt = cfg?.ignoreExtensionTabs !== false;
    const ifSupportTst = cfg?.ifSupportTst === true;
    const tstDelay = cfg?.tstDelay ?? 0;

    showModal(
      "Settings",
      `<div class="settings-form">
        <label>Auto-save history interval
          <span class="settings-hint">Minutes between automatic history snapshots (0 to disable)</span>
          <input type="number" id="cfg-interval" value="${interval}" min="0" max="1440" step="1" />
        </label>
        <label>History limit
          <span class="settings-hint">Maximum number of history entries to keep</span>
          <input type="number" id="cfg-limit" value="${limit}" min="1" max="1000" step="1" />
        </label>
        <div class="settings-checkbox-row">
          <label class="settings-checkbox-label" for="cfg-ignore-ext">
            <input type="checkbox" id="cfg-ignore-ext"${ignoreExt ? " checked" : ""} />
            Ignore extension tabs (moz-extension://)
          </label>
          <span class="settings-hint">Exclude the extension's own pages when saving sessions</span>
        </div>
        <div class="settings-checkbox-row">
          <label class="settings-checkbox-label" for="cfg-tst">
            <input type="checkbox" id="cfg-tst"${ifSupportTst ? " checked" : ""} />
            Tree Style Tab support
          </label>
          <span class="settings-hint">Restore tabs with parent-child relationships when using the Tree Style Tab addon</span>
        </div>
        <label>TST restore delay (ms)
          <span class="settings-hint">Delay between tab openings so Tree Style Tab can register each parent (0–2000)</span>
          <input type="number" id="cfg-tst-delay" value="${tstDelay}" min="0" max="2000" step="10" />
        </label>
        <div class="settings-group">
          <span class="settings-label">Backup</span>
          <div class="settings-row">
            <span class="settings-row-label">Export all data</span>
            <button class="btn btn-ghost settings-backup-btn" id="cfg-export-btn">Export</button>
          </div>
          <div class="settings-row">
            <span class="settings-row-label">Import / restore backup</span>
            <button class="btn btn-ghost settings-backup-btn" id="cfg-import-btn">Import</button>
          </div>
        </div>
      </div>`,
      [
        { label: "Cancel", cls: "btn-ghost", action: hideModal },
        {
          label: "Save", cls: "btn-primary", action: async () => {
            const newInterval    = parseInt((document.getElementById("cfg-interval") as HTMLInputElement).value) || 0;
            const newLimit       = parseInt((document.getElementById("cfg-limit") as HTMLInputElement).value) || 50;
            const newIgnoreExt   = (document.getElementById("cfg-ignore-ext") as HTMLInputElement).checked;
            const newIfSupportTst = (document.getElementById("cfg-tst") as HTMLInputElement).checked;
            const newTstDelay    = parseInt((document.getElementById("cfg-tst-delay") as HTMLInputElement).value) || 0;
            hideModal();
            await send({ type: "saveConfig", config: { historyInterval: newInterval, historyLimit: newLimit, ignoreExtensionTabs: newIgnoreExt, ifSupportTst: newIfSupportTst, tstDelay: newTstDelay } });
            toast("Settings saved");
          }
        },
      ]
    );

    // Defer until React re-renders the modal into the DOM
    setTimeout(() => {
      document.getElementById("cfg-export-btn")?.addEventListener("click", async () => {
        try {
          const data = await send({ type: "exportBackup" }) as Record<string, unknown>;
          await exportBackup(data);
        } catch {
          toast("Export failed");
        }
      });
      document.getElementById("cfg-import-btn")?.addEventListener("click", () => {
        const input = document.getElementById("import-backup-input") as HTMLInputElement | null;
        if (input) input.click();
        else toast("Import unavailable — reload the page");
      });
    }, 0);
  }

  async function openSyncModal() {
    const status = await send({ type: "cloudGetStatus" }) as {
      ok: boolean; email: string; lastSyncTime: number; syncing: boolean; redirectUri: string;
    };
    const email = status?.email || "";
    const lastSyncTime = status?.lastSyncTime || 0;
    const redirectUri = status?.redirectUri || "";

    if (email) {
      showModal(
        "Cloud Sync",
        `<div class="settings-form">
          <div class="sync-info-row">
            <span class="sync-info-label">Signed in as</span>
            <span class="sync-info-value">${email.replace(/</g,"&lt;")}</span>
          </div>
          <div class="sync-info-row">
            <span class="sync-info-label">Last synced</span>
            <span class="sync-info-value">${lastSyncTime ? new Date(lastSyncTime).toLocaleString() : "Never"}</span>
          </div>
        </div>`,
        [
          { label: "Close", cls: "btn-ghost", action: hideModal },
          {
            label: "Sign out", cls: "btn-danger", action: async () => {
              hideModal();
              await send({ type: "cloudSignOut" });
              toast("Signed out from Google Drive");
            }
          },
          {
            label: "Sync now", cls: "btn-primary", action: async () => {
              hideModal();
              toast("Syncing with Google Drive…");
              const result = await send({ type: "cloudSync" }) as { ok: boolean; error?: string };
              if (result.ok) { toast("Sync complete"); await loadSessions(); }
              else toast(`Sync failed: ${result.error ?? "unknown error"}`);
            }
          },
        ]
      );
    } else {
      showModal(
        "Cloud Sync — Google Drive",
        `<div class="settings-form">
          <p class="settings-hint" style="line-height:1.6">
            Sync collections across devices via Google Drive. Requires a Google Cloud OAuth 2.0 client.
            Set the authorised redirect URI to:<br>
            <code class="sync-redirect-uri">${redirectUri.replace(/</g,"&lt;") || "(loading…)"}</code>
          </p>
          <label>Client ID
            <input type="text" id="sync-client-id" placeholder="*.apps.googleusercontent.com" autocomplete="off" />
          </label>
          <label>Client Secret
            <input type="password" id="sync-client-secret" placeholder="GOCSPX-…" autocomplete="off" />
          </label>
        </div>`,
        [
          { label: "Cancel", cls: "btn-ghost", action: hideModal },
          {
            label: "Sign in with Google", cls: "btn-primary", action: async () => {
              const clientId     = (document.getElementById("sync-client-id") as HTMLInputElement).value.trim();
              const clientSecret = (document.getElementById("sync-client-secret") as HTMLInputElement).value.trim();
              if (!clientId || !clientSecret) { toast("Enter Client ID and Client Secret"); return; }
              hideModal();
              toast("Opening Google sign-in…");
              const result = await send({ type: "cloudSignIn", clientId, clientSecret }) as { ok: boolean; email?: string; error?: string };
              if (result.ok) toast(`Signed in as ${result.email}`);
              else toast(`Sign-in failed: ${result.error ?? "unknown error"}`);
            }
          },
        ]
      );
    }
  }

  const currentSession = state.sessions.find(s => s.id === state.view);

  function renderMainContent() {
    if (currentSession) {
      return <SessionView session={currentSession} onLoadSessions={loadSessions} />;
    }
    if (state.view === "history") {
      return <HistoryView onLoadSessions={loadSessions} />;
    }
    if (state.view === "closed") {
      return <ClosedView />;
    }
    if (state.view === "cookies") {
      return <CookieView />;
    }
    return <CurrentView onLoadSessions={loadSessions} />;
  }

  return (
    <div className={sidebarOpen ? "sidebar-open" : ""}>
      <TopBar
        onToggleSidebar={() => setSidebarOpen(o => !o)}
        onOpenSettings={openSettings}
        onOpenSync={openSyncModal}
      />

      <div
        id="sidebar-overlay"
        className="sidebar-overlay"
        onClick={() => setSidebarOpen(false)}
      />

      <div className="app-body">
        <Sidebar onLoadSessions={loadSessions} counts={counts} />

        <main className="main-content">
          {renderMainContent()}
        </main>
      </div>

      <SelectionBar onLoadSessions={loadSessions} />

      {/* Hidden file inputs for import */}
      <input type="file" id="import-json-input"   accept=".json,application/json" style={{ display: "none" }} />
      <input type="file" id="import-text-input"   accept=".txt,text/plain"        style={{ display: "none" }} />
      <input type="file" id="import-backup-input" accept=".json,application/json" style={{ display: "none" }} />

      <Toast />
      <Modal />
    </div>
  );
}
