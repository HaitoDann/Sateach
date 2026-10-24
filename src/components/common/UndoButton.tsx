import { Undo2 } from "lucide-react";
import { useVault } from "../../context/VaultContext";

/** ↶ in page headers: undoes the last action (also Ctrl+Z). */
export default function UndoButton() {
  const { undo, undoLabel } = useVault();
  return (
    <button
      onClick={() => void undo()}
      disabled={!undoLabel}
      title={undoLabel ? `Annuler : ${undoLabel} (Ctrl+Z)` : "Rien à annuler"}
      className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <Undo2 size={14} />
      Retour arrière
    </button>
  );
}
