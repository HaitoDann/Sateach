import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Archive, Check, ChevronDown, X, Clock, EyeOff, Pencil, Trash2 } from "lucide-react";
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

/** Textarea that grows with its content (no inner scrollbar). */
function AutoTextarea({ value, onChange, placeholder, minRows = 2, label }: {
  value: string; onChange: (v: string) => void; placeholder: string; minRows?: number; label: string;
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
      className="autogrow w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    />
  );
}

interface Props {
  session: DaySession;
  domain?: Domain;
  expanded: boolean;
  onToggle: () => void;
  /** Debounced text save (fields only — no reload needed). */
  onSaveText: (patch: EntryFields) => Promise<void>;
  onSetDone: (v: number) => void;
  onArchive: () => void;
  /** The séance is happening right now. */
  live?: boolean;
  onHide: () => void;
  onEditTime: () => void;
  onDelete?: () => void;
  index: number;
}

export default function SessionCard({ session, domain, expanded, onToggle, onSaveText, onSetDone, onArchive, live, onHide, onEditTime, onDelete, index }: Props) {
  const [values, setValues] = useState<Record<TextField, string>>({
    objectives: session.objectives,
    progression: session.progression,
    materials: session.materials,
    review: session.review,
  });
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
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

  // Hors-domaine séances (récréation, cantine…) are thin separators, not lessons.
  if (!domain) {
    return (
      <div className="group flex items-center gap-3 px-1 py-1 text-xs text-muted-foreground animate-item-in" style={{ animationDelay: `${index * 25}ms` }}>
        <span className="w-[92px] shrink-0 tabular-nums">{fmtTime(session.start_min)} – {fmtTime(session.end_min)}</span>
        <span className="h-px flex-1 bg-border" />
        <button onClick={onEditTime} className="rounded px-1 hover:bg-muted hover:text-foreground" title="Modifier">{title}</button>
        <span className="h-px w-6 bg-border" />
        <button onClick={onHide} title="Masquer pour ce jour" className="rounded p-1 opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100">
          <EyeOff size={12} />
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group rounded-xl border bg-card transition-shadow animate-item-in",
        expanded ? "border-border shadow-md" : "border-border/80 hover:shadow-sm",
        live && "ring-2 ring-primary/70"
      )}
      style={{ animationDelay: `${index * 25}ms` }}
    >
      <div className="flex items-stretch">
        {/* Time */}
        <div className="flex w-[92px] shrink-0 flex-col justify-center py-3 pl-4 tabular-nums">
          <span className="text-sm font-medium text-foreground">{fmtTime(session.start_min)}</span>
          <span className="text-xs text-muted-foreground">{fmtTime(session.end_min)}</span>
        </div>
        <div className="my-2.5 w-1 shrink-0 rounded-full" style={{ backgroundColor: color }} />

        {/* Title + preview */}
        <button onClick={onToggle} className="min-w-0 flex-1 px-4 py-3 text-left">
          <div className="flex items-center gap-2">
            <span className={cn("truncate font-medium text-foreground", session.done === 1 && "text-muted-foreground")}>
              {title}
            </span>
            <span
              className="shrink-0 rounded-full px-2 py-px text-[11px] font-medium text-foreground/80"
              style={{ backgroundColor: withAlpha(color!, 0.16) }}
            >
              {domain.name}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">{fmtDuration(session.end_min - session.start_min)}</span>
            {live && (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary px-2 py-px text-[11px] font-medium text-primary-foreground">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary-foreground" /> en cours
              </span>
            )}
            {session.oneOff && <span className="shrink-0 text-[11px] text-brand-700 dark:text-brand-300">ponctuelle</span>}
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
        <div className="flex shrink-0 items-start gap-0.5 py-2.5 pr-2.5">
          <div className="flex gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <IconBtn title="Archiver dans Mes cours" onClick={onArchive}><Archive size={14} /></IconBtn>
            <IconBtn title={session.slotId ? "Modifier l'horaire pour ce jour" : "Modifier la séance"} onClick={onEditTime}><Pencil size={14} /></IconBtn>
            {onDelete ? (
              <IconBtn title="Supprimer cette séance ponctuelle" onClick={onDelete} danger><Trash2 size={14} /></IconBtn>
            ) : (
              <IconBtn title="Annuler pour ce jour (sortie, absence…)" onClick={onHide}><EyeOff size={14} /></IconBtn>
            )}
          </div>
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
          <div className="mt-2 flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground">
            {status === "saving" && <><Clock size={11} /> Enregistrement…</>}
            {status === "saved" && <><Check size={11} className="text-brand-600" /> Enregistré</>}
          </div>
        </div>
      )}
    </div>
  );
}

function IconBtn({ title, onClick, children, danger }: { title: string; onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors",
        danger ? "hover:bg-destructive/10 hover:text-destructive" : "hover:bg-muted hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
