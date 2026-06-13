"use strict";

// ─── Drag state ───────────────────────────────────────────────────────────────

let _drag = null; // { type:"tab"|"window"|"session", winIdx?, tabSortIdx?, sessionId? }
let _session = null; // reference to the session being edited

// ─── Cleanup helpers ──────────────────────────────────────────────────────────

function clearDragClasses() {
  document.querySelectorAll(
    ".dd-tab-above, .dd-tab-below, .dd-win-over, .dd-win-dragging, .dd-session-over, .dd-session-dragging"
  ).forEach(el => el.classList.remove(
    "dd-tab-above", "dd-tab-below", "dd-win-over", "dd-win-dragging", "dd-session-over", "dd-session-dragging"
  ));
}

// ─── Session drag/drop (within saved session view) ────────────────────────────

function initSessionDragDrop(session, areaEl) {
  _session = session;

  areaEl.querySelectorAll(".window-block").forEach(block => {
    const winIdx = parseInt(block.dataset.winIdx, 10);
    setupWindowDrop(block, winIdx);

    block.querySelectorAll(".tab-row").forEach((row, tabSortIdx) => {
      setupTabDrag(row, winIdx, tabSortIdx);
    });
  });
}

// ── Tab drag source ──

function setupTabDrag(row, winIdx, tabSortIdx) {
  row.setAttribute("draggable", "true");

  row.addEventListener("dragstart", (e) => {
    _drag = { type: "tab", winIdx, tabSortIdx };
    e.dataTransfer.effectAllowed = "move";
    // Delay so the ghost image captures the non-faded state
    setTimeout(() => row.classList.add("dd-win-dragging"), 0);
  });

  row.addEventListener("dragend", () => {
    row.classList.remove("dd-win-dragging");
    clearDragClasses();
    _drag = null;
  });

  // Tab rows are also drop targets (for reordering / cross-window move)
  row.addEventListener("dragover", (e) => {
    if (!_drag || _drag.type !== "tab") return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const mid = row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
    clearTabInsertClasses(row.closest(".window-block"));
    row.classList.add(e.clientY < mid ? "dd-tab-above" : "dd-tab-below");
  });

  row.addEventListener("dragleave", (e) => {
    if (!row.contains(e.relatedTarget)) {
      row.classList.remove("dd-tab-above", "dd-tab-below");
    }
  });

  row.addEventListener("drop", (e) => {
    e.preventDefault();
    if (!_drag || _drag.type !== "tab") return;
    const above = row.classList.contains("dd-tab-above");
    row.classList.remove("dd-tab-above", "dd-tab-below");
    const insertAt = above ? tabSortIdx : tabSortIdx + 1;
    applyTabMove(_session, _drag.winIdx, _drag.tabSortIdx, winIdx, insertAt);
  });
}

function clearTabInsertClasses(block) {
  if (!block) return;
  block.querySelectorAll(".dd-tab-above, .dd-tab-below").forEach(el => {
    el.classList.remove("dd-tab-above", "dd-tab-below");
  });
}

// ── Window drag source + drop target ──

function setupWindowDrop(block, winIdx) {
  const header = block.querySelector(".window-header");
  const body   = block.querySelector(".window-body");

  // Drag the window header to move/merge the whole window
  if (header) {
    header.setAttribute("draggable", "true");

    header.addEventListener("dragstart", (e) => {
      // Don't steal drag events that started on a tab row inside the header area
      if (e.target.closest(".tab-row")) return;
      e.stopPropagation();
      _drag = { type: "window", winIdx };
      e.dataTransfer.effectAllowed = "move";
      setTimeout(() => block.classList.add("dd-win-dragging"), 0);
    });

    header.addEventListener("dragend", () => {
      block.classList.remove("dd-win-dragging");
      clearDragClasses();
      _drag = null;
    });

    // Drop window onto another window header → merge
    header.addEventListener("dragover", (e) => {
      if (!_drag || _drag.type !== "window" || _drag.winIdx === winIdx) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      block.classList.add("dd-win-over");
    });

    header.addEventListener("dragleave", (e) => {
      if (!block.contains(e.relatedTarget)) block.classList.remove("dd-win-over");
    });

    header.addEventListener("drop", (e) => {
      e.preventDefault();
      block.classList.remove("dd-win-over");
      if (!_drag || _drag.type !== "window" || _drag.winIdx === winIdx) return;
      applyWindowMerge(_session, _drag.winIdx, winIdx);
    });
  }

  // Drop a tab onto the window body empty space → append to end of that window
  if (body) {
    body.addEventListener("dragover", (e) => {
      if (!_drag || _drag.type !== "tab") return;
      if (_drag.winIdx === winIdx) return; // already in this window — handled by row drop
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      block.classList.add("dd-win-over");
    });

    body.addEventListener("dragleave", (e) => {
      if (!block.contains(e.relatedTarget)) block.classList.remove("dd-win-over");
    });

    body.addEventListener("drop", (e) => {
      // Only handle drops that landed on the body itself (not a child tab row)
      if (e.target.closest(".tab-row")) return;
      e.preventDefault();
      block.classList.remove("dd-win-over");
      if (!_drag || _drag.type !== "tab" || _drag.winIdx === winIdx) return;
      const dst = _session.windows[winIdx].tabs.length;
      applyTabMove(_session, _drag.winIdx, _drag.tabSortIdx, winIdx, dst);
    });
  }
}

// ─── Data mutations ───────────────────────────────────────────────────────────

function applyTabMove(session, srcWin, srcTabSort, dstWin, dstTabSort) {
  const srcWindow = session.windows[srcWin];
  const dstWindow = session.windows[dstWin];

  const srcSorted = [...srcWindow.tabs].sort((a, b) => a.index - b.index);
  const tab = srcSorted[srcTabSort];
  if (!tab) return;

  // Remove tab from source window
  srcWindow.tabs = srcWindow.tabs.filter(t => t !== tab);
  srcWindow.tabs.sort((a, b) => a.index - b.index).forEach((t, i) => { t.index = i; });

  // Adjust insert position when moving within the same window (removed tab shifts indices)
  let insertAt = dstTabSort;
  if (srcWin === dstWin && srcTabSort < dstTabSort) insertAt = Math.max(0, dstTabSort - 1);
  insertAt = Math.min(insertAt, dstWindow.tabs.length);

  // Shift existing tabs to make room
  dstWindow.tabs.forEach(t => { if (t.index >= insertAt) t.index++; });
  tab.index = insertAt;

  // Clear group when moving to a different window
  if (srcWin !== dstWin) {
    tab.groupId    = -1;
    tab.groupColor = undefined;
    tab.groupTitle = undefined;
  }

  dstWindow.tabs.push(tab);

  // Drop source window if empty after move
  if (srcWindow.tabs.length === 0 && srcWin !== dstWin) {
    session.windows.splice(srcWin, 1);
  }

  persistAndRerender(session);
}

function applyWindowMerge(session, srcWin, dstWin) {
  const srcWindow = session.windows[srcWin];
  // Splice first so dstWin index may shift
  session.windows.splice(srcWin, 1);
  const actualDst = srcWin < dstWin ? dstWin - 1 : dstWin;
  const dstWindow = session.windows[actualDst];

  const offset = dstWindow.tabs.length;
  for (const tab of srcWindow.tabs) {
    tab.index = offset + tab.index;
    tab.groupId    = -1;
    tab.groupColor = undefined;
    tab.groupTitle = undefined;
    dstWindow.tabs.push(tab);
  }

  persistAndRerender(session);
}

function persistAndRerender(session) {
  session.tabCount    = session.windows.reduce((s, w) => s + w.tabs.length, 0);
  session.windowCount = session.windows.length;
  send({ type: "updateSession", session }).then(() => {
    const idx = state.sessions.findIndex(s => s.id === session.id);
    if (idx !== -1) state.sessions[idx] = session;
    renderSessionView(session);
    toast("Collection updated");
  }).catch(() => toast("Failed to save"));
}

// ─── Sidebar collection drag/drop (merge two collections) ─────────────────────

function initSidebarDragDrop() {
  document.querySelectorAll(".session-nav-item[data-id]").forEach(item => {
    const id = item.dataset.id;

    item.setAttribute("draggable", "true");

    item.addEventListener("dragstart", (e) => {
      // Don't hijack if this is already a selection ctrl/shift-click flow
      _drag = { type: "session", id };
      e.dataTransfer.effectAllowed = "move";
      item.classList.add("dd-session-dragging");
    });

    item.addEventListener("dragend", () => {
      item.classList.remove("dd-session-dragging");
      clearDragClasses();
      _drag = null;
    });

    item.addEventListener("dragover", (e) => {
      if (!_drag || _drag.type !== "session" || _drag.id === id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      item.classList.add("dd-session-over");
    });

    item.addEventListener("dragleave", () => {
      item.classList.remove("dd-session-over");
    });

    item.addEventListener("drop", async (e) => {
      e.preventDefault();
      item.classList.remove("dd-session-over");
      if (!_drag || _drag.type !== "session" || _drag.id === id) return;

      const srcId = _drag.id;
      const dstId = id;
      _drag = null; // clear early to prevent double-fire

      const srcName = state.sessions.find(s => s.id === srcId)?.name ?? "collection";
      const dstName = state.sessions.find(s => s.id === dstId)?.name ?? "collection";

      showModal(
        "Merge collections",
        `<p>Merge <strong>${esc(srcName)}</strong> into <strong>${esc(dstName)}</strong>?<br>The source collection will be deleted.</p>`,
        [
          { label: "Cancel", cls: "btn-ghost", action: hideModal },
          { label: "Merge",  cls: "btn-primary", action: async () => {
            hideModal();
            const [src, dst] = await Promise.all([
              send({ type: "getSession", id: srcId }),
              send({ type: "getSession", id: dstId }),
            ]);
            if (!src || !dst) { toast("Could not load collections"); return; }

            dst.windows   = [...dst.windows, ...src.windows];
            dst.tabCount  = dst.windows.reduce((s, w) => s + w.tabs.length, 0);
            dst.windowCount = dst.windows.length;

            await send({ type: "updateSession", session: dst });
            await send({ type: "deleteSession", id: srcId });
            toast(`Merged into "${dst.name}"`);

            await loadSessions();
            renderSidebar();

            if (state.view === srcId) {
              selectView(dstId);
            } else if (state.view === dstId) {
              const updated = state.sessions.find(s => s.id === dstId);
              if (updated) renderSessionView(updated);
            }
          }},
        ]
      );
    });
  });
}
