import { cn } from "../../lib/utils";

/** Bilan coloré d'une séance. Status colours carry an icon-free label too
 *  (never colour alone): the title/label says what each one means. */
export const RATINGS = [
  { value: 1, color: "#22a06b", label: "Bonne séance, à réutiliser" },
  { value: 2, color: "#e2b203", label: "Bonne, mais à modifier" },
  { value: 3, color: "#e5484d", label: "Séance à revoir" },
] as const;

export function ratingOf(v: number) {
  return RATINGS.find((r) => r.value === v);
}

export function RatingDot({ value, className }: { value: number; className?: string }) {
  const r = ratingOf(value);
  if (!r) return null;
  return <span title={r.label} className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-card", className)} style={{ backgroundColor: r.color }} />;
}

/** Three choices; clicking the selected one clears it. */
export function RatingPicker({ value, onChange, compact }: { value: number; onChange: (v: number) => void; compact?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {RATINGS.map((r) => {
        const on = value === r.value;
        return (
          <button
            key={r.value}
            type="button"
            onClick={() => onChange(on ? 0 : r.value)}
            title={r.label}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
              on ? "border-transparent font-medium text-foreground" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
            style={on ? { backgroundColor: `${r.color}26`, boxShadow: `inset 0 0 0 1.5px ${r.color}` } : undefined}
          >
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: r.color }} />
            {!compact && r.label}
          </button>
        );
      })}
    </div>
  );
}
