import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

interface DialogProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
  footer?: ReactNode;
}

export function Dialog({ title, children, onClose, className, footer }: DialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 bg-black/25 z-40 backdrop-blur-[1px]" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className={cn(
            "w-full max-w-md rounded-xl border border-border bg-card shadow-xl animate-view-enter",
            className
          )}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="font-medium text-foreground">{title}</h2>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <X size={16} />
            </button>
          </div>
          <div className="p-5">{children}</div>
          {footer && (
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
              {footer}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
