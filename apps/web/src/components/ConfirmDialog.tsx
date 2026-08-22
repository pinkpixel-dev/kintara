import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Replaces the desktop build's native `ask()` dialogs.
 *
 * `window.confirm` would have worked, but it blocks the main thread, cannot be
 * styled, and looks like a browser warning rather than part of the app. This
 * keeps focus trapped, closes on Escape, and puts initial focus on Cancel so a
 * stray Enter never destroys anything.
 */
export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    cancelRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }

      if (event.key !== "Tab") return;

      // Focus trap: without this, Tab walks into the page behind the dialog.
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed-overlay z-100 animate-in fade-in duration-150"
      onClick={onCancel}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="modal-content"
        style={{ maxWidth: "420px" }}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="confirm-dialog-title" className="dialog-title flex items-center gap-2">
            {danger && <AlertTriangle size={18} className="dialog-danger-icon" aria-hidden="true" />}
            {title}
          </h2>
        </div>

        <div className="modal-body">
          <p id="confirm-dialog-message" className="text-sm text-secondary m-0">
            {message}
          </p>

          <div className="dialog-actions">
            <button ref={cancelRef} className="btn btn-ghost" onClick={onCancel}>
              {cancelLabel}
            </button>
            <button
              className={
                danger
                  ? "btn btn-ghost btn-danger-ghost"
                  : "btn btn-primary"
              }
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
