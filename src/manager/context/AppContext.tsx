import { createContext, useContext, useReducer, useRef, useCallback, type ReactNode } from "react";
import type { AppState, AppAction, ModalAction, UndoSnapshot } from "./types";

const initialState: AppState = {
  sessions: [],
  view: "current",
  searchQuery: "",
  selectedTabKeys: new Set(),
  lastTabKey: null,
  tabRenderOrder: [],
  selectedSessionIds: new Set(),
  lastSessionId: null,
  historyEntry: null,
  undoSnapshot: null,
  redoSnapshot: null,
  toastMsg: null,
  toastAction: null,
  toastActionLabel: "Undo",
  modalOpen: false,
  modalTitle: "",
  modalBody: "",
  modalActions: [],
};

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_SESSIONS":      return { ...state, sessions: action.sessions };
    case "SET_VIEW":          return { ...state, view: action.view, historyEntry: null, selectedTabKeys: new Set() };
    case "SET_SEARCH":        return { ...state, searchQuery: action.query };
    case "SET_SELECTED_TABS": return { ...state, selectedTabKeys: action.keys };
    case "SET_LAST_TAB_KEY":  return { ...state, lastTabKey: action.key };
    case "SET_TAB_RENDER_ORDER": return { ...state, tabRenderOrder: action.order };
    case "SET_SELECTED_SESSIONS": return { ...state, selectedSessionIds: action.ids };
    case "SET_LAST_SESSION_ID":   return { ...state, lastSessionId: action.id };
    case "SET_HISTORY_ENTRY": return { ...state, historyEntry: action.entry };

    case "PUSH_UNDO":
      return { ...state, undoSnapshot: action.snapshot, redoSnapshot: null };
    case "APPLY_UNDO":
      return {
        ...state,
        undoSnapshot: null,
        redoSnapshot: action.redoSnapshot,
        sessions: action.sessions ?? state.sessions,
      };
    case "APPLY_REDO":
      return {
        ...state,
        redoSnapshot: null,
        undoSnapshot: action.undoSnapshot,
        sessions: action.sessions ?? state.sessions,
      };
    case "CLEAR_UNDO_REDO":
      return { ...state, undoSnapshot: null, redoSnapshot: null };

    case "SHOW_TOAST":
      return {
        ...state,
        toastMsg: action.msg,
        toastAction: action.action ?? null,
        toastActionLabel: action.actionLabel ?? "Undo",
      };
    case "HIDE_TOAST":
      return { ...state, toastMsg: null, toastAction: null };

    case "SHOW_MODAL":
      return { ...state, modalOpen: true, modalTitle: action.title, modalBody: action.body, modalActions: action.actions };
    case "HIDE_MODAL":
      return { ...state, modalOpen: false };

    default:
      return state;
  }
}

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
  // Convenience helpers that components use frequently
  toast: (msg: string, action?: () => void, actionLabel?: string) => void;
  showModal: (title: string, body: string, actions: ModalAction[]) => void;
  hideModal: () => void;
  pushUndo: (snapshot: UndoSnapshot) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((msg: string, action?: () => void, actionLabel = "Undo") => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    dispatch({ type: "SHOW_TOAST", msg, action, actionLabel });
    toastTimerRef.current = setTimeout(
      () => dispatch({ type: "HIDE_TOAST" }),
      action ? 5000 : 2500
    );
  }, []);

  const showModal = useCallback((title: string, body: string, actions: ModalAction[]) => {
    dispatch({ type: "SHOW_MODAL", title, body, actions });
  }, []);

  const hideModal = useCallback(() => dispatch({ type: "HIDE_MODAL" }), []);

  const pushUndo = useCallback((snapshot: UndoSnapshot) => {
    dispatch({ type: "PUSH_UNDO", snapshot });
  }, []);

  return (
    <AppContext.Provider value={{ state, dispatch, toast, showModal, hideModal, pushUndo }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
