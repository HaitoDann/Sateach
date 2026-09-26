import type { ReactNode } from "react";

/** The 56px bar on top of every page (same rhythm as Nilo's header). */
export default function PageHeader({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-background px-6">
      <div className="flex min-w-0 flex-1 items-baseline gap-3">
        <h1 className="truncate font-medium text-foreground">{title}</h1>
        {subtitle && <span className="truncate text-sm text-muted-foreground">{subtitle}</span>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </header>
  );
}
