import { useEffect, useRef, useState } from "react";
import { AutoTextarea } from "../ui/AutoTextarea";
import { Check, ChevronDown, X, Clock, ClipboardCopy, Copy, Eye, EyeOff, FileText, GripVertical, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import Attachments from "../common/Attachments";
import { RatingDot, RatingPicker } from "../common/Rating";
import { sessionDrag } from "../../lib/nav";
import type { DaySession, Domain, EntryFields } from "../../lib/types";
import { fmtDuration, fmtTime } from "../../lib/time";
import { cn, withAlpha } from "../../lib/utils";

/** Dispatched before printing so every card saves its pending edits. */
export const FLUSH_EVENT = "sateach:flush";

type TextField = "objectives" | "progression" | "materials" | "review";

export const FIELDS: { key: TextField; label: string; placeholder: string; wide?: boolean }[] = [
  { key: "objectives", label: "Objectifs", placeholder: "Ce que les élèves doivent savoir ou savoir-faire à la fin de la séance…", wide: true },
  { key: "progression", label: "Déroulement", placeholder: "Phases, consignes, organisation (collectif, groupes, individuel), durées…", wide: true },
  { key: "materials", label: "Matériel", placeholder: "Manuel p. 12, ardoises, fiche d'exercices…" },
  { key: "review", label: "Bilan / remarques", placeholder: "Ce qui a fonctionné, élèves à revoir, à reprendre demain…" },
];

interface Props {
  session: DaySession;
  domain?: Domain;
  expanded: boolean;
  onToggle: () => void;
  /** Debounced text save (fields only — no reload needed). */
  onSaveText: (patch: EntryFields) => Promise<void>;
  onSetDone: (v: number) => void;
  /** The séance is happening right now. */
  live?: boolean;
  onEdit: () => void;
  onCopy: () => void;
  onPrep: () => void;
  onHide: () => void;
  onUnhide: () => void;
  onDelete: () => void;
  onRate: (v: number) => void;
  /** Clic droit › Copier. */
  onClipboardCopy: () => void;
  index: number;
}

export default function SessionCard({
  session, domain, expanded, onToggle, onSaveText, onSetDone, live, onEdit, onCopy, onPrep, onHide, onUnhide, onDelete, onRate, onClipboardCopy, index,
}: Props) {
  const [values, setValues] = useState<Record<TextField, string>>({
    objectives: session.objectives,
    progression: session.progression,
    materials: session.materials,
    review: session.review,
  });
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [menu, setMenu] = useState<null | { x: number; y: number }>(null);
  const pending = useRef<EntryFields>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(onSaveText);
  saveRef.current = onSaveText;

  const flush = useRef(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const patch = pending.current;
    if (Object.keys(patch).length === 0) return;
    pending.current = {};
    await saveRef.current(patch);
    setStatus("saved");
  }).current;

  // Save what's pending when the card goes away (day change, page change).
  useEffect(() => {
    const onFlush = () => { void flush(); };
    window.addEventListener(FLUSH_EVENT, onFlush);
    return () => {
      window.removeEventListener(FLUSH_EVENT, onFlush);
      void flush();
    };
  }, [flush]);

  // Text edited elsewhere (undo, copy) → follow the stored values.
  useEffect(() => {
    if (Object.keys(pending.current).length) return;
    setValues({ objectives: session.objectives, progression: session.progression, materials: session.materials, review: session.review });
  }, [session.objectives, session.progression, session.materials, session.review]);

  function change(key: TextField, v: string) {
    setValues((cur) => ({ ...cur, [key]: v }));
    pending.current = { ...pending.current, [key]: v };
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, 600);
  }

  const color = domain?.color;
  const title = session.title.trim() || domain?.name || "Séance";
  const filled = FIELDS.filter((f) => values[f.key].trim());

  // Masquée pour ce jour: stays in place, greyed, with an obvious way back.
  if (session.hidden === 1) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-4 py-2.5 animate-item-in">
        <span className="w-[76px] shrink-0 text-xs tabular-nums text-muted-foreground">{fmtTime(session.start_min)} – {fmtTime(session.end_min)}</span>
        <EyeOff size={14} className="shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          <span className="line-through">{title}</span>
          <span className="ml-2 text-xs">masquée pour ce jour</span>
        </span>
        <button onClick={onUnhide} className="flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90">
          <Eye size={13} /> Réafficher
        </button>
        <button onClick={onDelete} title="Supprimer de ce jour" className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
          <Trash2 size={14} />
        </button>
      </div>
    );
  }

  const neutral = !domain;

  return (
    <div
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY }); }}
      className={cn(
        "group rounded-xl border bg-card transition-shadow animate-item-in",
        expanded ? "border-border shadow-md" : "border-border/80 hover:shadow-sm",
        live && "ring-2 ring-primary/70"
      )}
      style={{ animationDelay: `${index * 25}ms` }}
    >
      <div className="flex items-stretch">
        {/* Drag handle: drop on a day of the week (side panel) to copy */}
        <div
          draggable
          onDragStart={(e) => { sessionDrag.key = session.key; e.dataTransfer.effectAllowed = "copy"; e.dataTransfer.setData("text/plain", title); }}
          onDragEnd={() => { sessionDrag.key = null; }}
          title="Glisser sur un jour de la semaine (à droite) pour copier la séance"
          className="flex w-5 shrink-0 cursor-grab items-center justify-center rounded-l-xl text-muted-foreground/40 hover:bg-muted hover:text-muted-foreground active:cursor-grabbing"
        >
          <GripVertical size={14} />
        </div>
        {/* Time */}
        <div className="flex w-[64px] shrink-0 flex-col justify-center py-3 pl-1 tabular-nums">
          <span className="text-sm font-medium text-foreground">{fmtTime(session.start_min)}</span>
          <span className="text-xs text-muted-foreground">{fmtTime(session.end_min)}</span>
        </div>
        <div
          className={cn("my-2.5 w-1 shrink-0 rounded-full", neutral && "bg-muted-foreground/30")}
          style={color ? { backgroundColor: color } : undefined}
        />

        {/* Title + preview */}
        <button onClick={onToggle} className="min-w-0 flex-1 px-4 py-3 text-left">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <RatingDot value={session.rating} />
            <span className={cn("truncate font-medium text-foreground", session.done === 1 && "text-muted-foreground")}>{title}</span>
            <span
              className={cn("shrink-0 rounded-full px-2 py-px text-[11px] font-medium", neutral ? "bg-muted text-muted-foreground" : "text-foreground/80")}
              style={color ? { backgroundColor: withAlpha(color, 0.16) } : undefined}
            >
              {domain?.name ?? "Autre"}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">{fmtDuration(session.end_min - session.start_min)}</span>
            {session.prepId && (
              <span
                role="link"
                onClick={(e) => { e.stopPropagation(); onPrep(); }}
                className="flex shrink-0 items-center gap-1 rounded-full border border-primary/40 px-2 py-px text-[11px] text-brand-700 hover:bg-accent dark:text-brand-300"
              >
                <FileText size={11} /> Fiche de prépa
              </span>
            )}
            {live && (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary px-2 py-px text-[11px] font-medium text-primary-foreground">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary-foreground" /> en cours
              </span>
            )}
            {session.oneOff && <span className="shrink-0 text-[11px] text-brand-700 dark:text-brand-300">ce jour uniquement</span>}
          </div>
          {!expanded && filled.length > 0 && (
            <div className="mt-1.5 space-y-0.5">
              {filled.map((f) => (
                <p key={f.key} className="line-clamp-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/70">{f.label} · </span>
                  {values[f.key]}
                </p>
              ))}
            </div>
          )}
          {!expanded && filled.length === 0 && (
            <p className="mt-1 text-xs text-muted-foreground/70">Cliquez pour détailler la séance</p>
          )}
        </button>

        {/* Actions */}
        <div className="flex shrink-0 items-start gap-1 py-2.5 pr-2.5">
          {/* Validation: faite / non faite (click again to clear) */}
          <div className="flex overflow-hidden rounded-full border border-border">
            <button
              onClick={() => onSetDone(session.done === 1 ? 0 : 1)}
              title={session.done === 1 ? "Retirer la validation" : "Séance faite"}
              className={cn(
                "flex h-7 items-center gap-1 px-2 text-xs transition-colors",
                session.done === 1 ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <Check size={13} strokeWidth={2.5} />
              {session.done === 1 && "Faite"}
            </button>
            <button
              onClick={() => onSetDone(session.done === 2 ? 0 : 2)}
              title={session.done === 2 ? "Retirer la validation" : "Séance non faite"}
              className={cn(
                "flex h-7 items-center gap-1 border-l border-border px-2 text-xs transition-colors",
                session.done === 2 ? "bg-destructive/15 font-medium text-destructive" : "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              )}
            >
              <X size={13} strokeWidth={2.5} />
              {session.done === 2 && "Non faite"}
            </button>
          </div>

          {/* Menu with every action, labelled (also on right-click) */}
          <button onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.right - 256, y: r.bottom + 4 }); }} title="Actions (ou clic droit)" className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
            <MoreHorizontal size={16} />
          </button>
          {menu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
              <div
                className="fixed z-50 w-64 rounded-lg border border-border bg-card py-1 shadow-xl"
                style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 270)), top: Math.min(menu.y, window.innerHeight - 300) }}
                onClick={() => setMenu(null)}
              >
                <MenuItem icon={<ClipboardCopy size={14} />} label="Copier" hint="puis clic droit › Coller sur un autre jour" onClick={onClipboardCopy} />
                <MenuItem icon={<Copy size={14} />} label="Copier vers d'autres jours…" onClick={onCopy} />
                <MenuItem icon={<Pencil size={14} />} label="Modifier pour ce jour" hint="l'emploi du temps ne change pas" onClick={onEdit} />
                <MenuItem icon={<FileText size={14} />} label={session.prepId ? "Ouvrir la fiche de préparation" : "Créer la fiche de préparation"} onClick={onPrep} />
                <div className="my-1 h-px bg-border" />
                <MenuItem icon={<EyeOff size={14} />} label="Masquer pour ce jour" hint="réaffichable à tout moment" onClick={onHide} />
                <MenuItem icon={<Trash2 size={14} />} label="Supprimer de ce jour…" danger onClick={onDelete} />
              </div>
            </>
          )}

          <button onClick={onToggle} title={expanded ? "Replier" : "Détailler"} className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
            <ChevronDown size={16} className={cn("transition-transform duration-200", expanded && "rotate-180")} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            {FIELDS.map((f) => (
              <div key={f.key} className={cn("space-y-1", f.wide && "col-span-2")}>
                <label className="text-xs font-medium text-muted-foreground">{f.label}</label>
                <AutoTextarea
                  label={f.label}
                  value={values[f.key]}
                  onChange={(v) => change(f.key, v)}
                  placeholder={f.placeholder}
                  minRows={f.key === "progression" ? 4 : 2}
                />
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-muted/40 px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">Bilan de la séance</span>
            <RatingPicker value={session.rating} onChange={onRate} />
          </div>
          <Attachments ownerType="entry" ownerId={session.entryId} className="mt-3" />
          <div className="mt-2 flex items-center justify-between gap-1.5 text-[11px] text-muted-foreground">
            <button onClick={onPrep} className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-brand-700 hover:bg-accent dark:text-brand-300">
              <FileText size={12} /> {session.prepId ? "Ouvrir la fiche de préparation" : "Préparer en détail (fiche de préparation)"}
            </button>
            <span className="flex items-center gap-1.5">
              {status === "saving" && <><Clock size={11} /> Enregistrement…</>}
              {status === "saved" && <><Check size={11} className="text-brand-600" /> Enregistré</>}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, hint, onClick, danger }: { icon: React.ReactNode; label: string; hint?: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn("flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm transition-colors", danger ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-muted")}
    >
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
      <span>
        {label}
        {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
      </span>
    </button>
  );
}
