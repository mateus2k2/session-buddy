import { useApp } from "../../context/AppContext";

export function Modal() {
  const { state, hideModal } = useApp();
  const { modalOpen, modalTitle, modalBody, modalActions } = state;

  if (!modalOpen) return null;

  return (
    <div className="modal-overlay" onClick={hideModal}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">{modalTitle}</div>
        <div
          className="modal-body"
          dangerouslySetInnerHTML={{ __html: modalBody }}
        />
        <div className="modal-actions">
          {modalActions.map((a, i) => (
            <button key={i} className={`btn ${a.cls ?? "btn-ghost"}`} onClick={a.action}>
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
