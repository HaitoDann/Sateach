import { useLayoutEffect, useRef } from "react";
import { cn } from "../../lib/utils";

/** Textarea that grows with its content (no inner scrollbar). */
export function AutoTextarea({ value, onChange, placeholder, minRows = 2, label, className }: {
  value: string; onChange: (v: string) => void; placeholder?: string; minRows?: number; label?: string; className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(
        "autogrow w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className
      )}
    />
  );
}
