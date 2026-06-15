import { useApp } from "../../context/AppContext";

export function Toast() {
  const { state, dispatch } = useApp();
  const { toastMsg, toastAction, toastActionLabel } = state;

  if (!toastMsg) return null;

  return (
    <div className="toast">
      <span>{toastMsg}</span>
      {toastAction && (
        <button
          className="toast-action-btn"
          onClick={() => {
            dispatch({ type: "HIDE_TOAST" });
            toastAction();
          }}
        >
          {toastActionLabel}
        </button>
      )}
    </div>
  );
}
