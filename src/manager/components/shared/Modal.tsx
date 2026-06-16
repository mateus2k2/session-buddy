import { useEffect, useRef } from "react";
import { useApp } from "../../context/AppContext";

export function Modal() {
  const { state, hideModal } = useApp();
  const { modalOpen, modalTitle, modalBody, modalActions } = state;
  const modalRef = useRef<HTMLDivElement>(null);

  // Focus the right element every time the modal opens
  useEffect(() => {
    if (!modalOpen) return;
    // Defer until React has painted the new body content into the DOM
    const id = setTimeout(() => {
      const el = modalRef.current;
      if (!el) return;
      const firstInput = el.querySelector<HTMLElement>("input, textarea, select");
      if (firstInput) {
        firstInput.focus();
        if (firstInput instanceof HTMLInputElement) firstInput.select();
      } else {
        // No input — focus the primary/danger button so Enter confirms and Tab cycles
        const primary = el.querySelector<HTMLButtonElement>(".btn-primary, .btn-danger")
          ?? el.querySelector<HTMLButtonElement>(".modal-actions button:last-child");
        primary?.focus();
      }
    }, 0);
    return () => clearTimeout(id);
  }, [modalOpen, modalBody]);

  // Enter inside a text input → click the primary action button
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter") return;
    const target = e.target as HTMLElement;
    if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") return;
    e.preventDefault();
    const primary = modalRef.current?.querySelector<HTMLButtonElement>(".btn-primary, .btn-danger");
    primary?.click();
  }

  if (!modalOpen) return null;

  return (
    <div className="modal-overlay" onClick={hideModal}>
      <div
        className="modal"
        ref={modalRef}
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
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
