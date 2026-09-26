import { useRef, useState, useLayoutEffect, useEffect } from "react";
import { cn } from "../../lib/utils";

interface Option<T extends string> {
  value: T;
  label: string;
}

/** A small segmented control with an accent pill that slides to the active option. */
export function SegmentedControl<T extends string>({
  options, value, onChange, className,
}: {
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [pill, setPill] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  const measure = () => {
    const el = refs.current[value];
    if (el) setPill({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight });
  };

  useLayoutEffect(measure, [value, options.length]);
  // Re-measure on resize (closure recreated each render keeps `value` fresh).
  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  });

  return (
    <div className={cn("relative flex items-center gap-1 rounded-md border border-border p-1", className)}>
      <div
        className="pointer-events-none absolute rounded bg-primary shadow-sm transition-all duration-300 ease-aqua"
        style={{
          left: pill?.left ?? 0,
          top: pill?.top ?? 0,
          width: pill?.width ?? 0,
          height: pill?.height ?? 0,
          opacity: pill ? 1 : 0,
        }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          ref={(el) => { refs.current[o.value] = el; }}
          onClick={() => onChange(o.value)}
          className={cn(
            "relative z-10 rounded px-2.5 py-1 text-xs transition-colors duration-200",
            value === o.value ? "text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
