import { X } from "lucide-react";
import { motion } from "motion/react";
import {
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";

type ModalProps = {
  bodyClassName?: string;
  children: ReactNode;
  contentClassName?: string;
  footer?: ReactNode;
  isOpen: boolean;
  disableEscapeClose?: boolean;
  onClose: () => void;
  size?: "compact" | "default" | "medium" | "wide";
  subtitle?: string;
  title: string;
};

export function Modal({
  bodyClassName = "overflow-y-auto p-5",
  children,
  contentClassName = "",
  footer,
  isOpen,
  disableEscapeClose = false,
  onClose,
  size = "default",
  subtitle,
  title,
}: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const activeElement = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !disableEscapeClose) {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements =
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );

      if (!focusableElements?.length) {
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        document.activeElement === last
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      activeElement?.focus();
    };
  }, [disableEscapeClose, isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <motion.div
      animate={{ opacity: 1 }}
      aria-labelledby={titleId}
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-[var(--color-overlay)] p-5 backdrop-blur-md"
      exit={{ opacity: 0 }}
      initial={{ opacity: 0 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      role="dialog"
      transition={{ duration: 0.16 }}
    >
      <motion.div
        ref={dialogRef}
        animate={{
          opacity: 1,
          scale: 1,
          y: 0,
        }}
        className={`neu-raised-lg flex max-h-[calc(100vh-2.5rem)] flex-col overflow-hidden rounded-2xl border border-border/70 bg-elevated ${
          size === "wide"
            ? "h-[calc(100vh-2.5rem)] w-[calc(100vw-2.5rem)]"
            : size === "compact"
              ? "w-full max-w-md"
              : size === "medium"
                ? "w-full max-w-2xl"
                : "w-full max-w-lg"
        } ${contentClassName}`}
        exit={{
          opacity: 0,
          scale: 0.98,
          y: 8,
        }}
        initial={{
          opacity: 0,
          scale: 0.98,
          y: 8,
        }}
        tabIndex={-1}
        transition={{ duration: 0.16 }}
      >
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between border-b border-border-subtle px-5 py-3.5">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-base font-semibold leading-tight text-text"
            >
              {title}
            </h2>

            {subtitle && (
              <p className="mt-1 text-xs text-muted">
                {subtitle}
              </p>
            )}
          </div>

          <button
            aria-label="Close dialog"
            className="neu-raised ml-4 flex size-10 shrink-0 items-center justify-center rounded-xl text-muted transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-elevation-3)] hover:text-text active:translate-y-0 active:shadow-[var(--shadow-inset)] focus:outline-none focus:ring-2 focus:ring-primary/40"
            onClick={onClose}
            type="button"
          >
            <X className="size-5" />
          </button>
        </header>

        {/* Body */}
        <div
          className={`min-h-0 flex-1 ${bodyClassName}`}
        >
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border-subtle px-5 py-3">
            {footer}
          </footer>
        )}
      </motion.div>
    </motion.div>
  );
}
