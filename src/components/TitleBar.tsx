import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { cn } from "../lib/utils";
import { isTauri } from "../lib/platform";

// Frameless window (decorations: false) → our own discreet title bar, as in Nilo.
export default function TitleBar() {
  if (!isTauri()) return null;
  const win = getCurrentWindow();
  const btn = "flex h-8 w-12 items-center justify-center text-muted-foreground transition-colors";

  return (
    <div
      data-tauri-drag-region
      className="flex h-8 w-full shrink-0 select-none items-center justify-end border-b border-border/40 bg-background"
    >
      <button onClick={() => win.minimize()} className={cn(btn, "hover:bg-muted hover:text-foreground")} title="Réduire">
        <Minus size={14} />
      </button>
      <button onClick={() => win.toggleMaximize()} className={cn(btn, "hover:bg-muted hover:text-foreground")} title="Agrandir">
        <Square size={12} />
      </button>
      <button onClick={() => win.close()} className={cn(btn, "hover:bg-red-500 hover:text-white")} title="Fermer">
        <X size={14} />
      </button>
    </div>
  );
}
