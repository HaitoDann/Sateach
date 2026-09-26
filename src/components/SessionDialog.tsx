import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Dialog } from "./ui/Dialog";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { useVault } from "../context/VaultContext";
import { suggestionsFor } from "../lib/domains";
import { DAY_SHORT, fmtDuration, fmtTime, parseTime } from "../lib/time";
import { cn, withAlpha } from "../lib/utils";

export interface SessionValues {
  title: string;
  domain_id: string | null;
  start_min: number;
  end_min: number;
  days: number[];
}

interface Props {
  heading: string;
  initial: SessionValues;
  /** Show the day picker; `multiDay` lets a new séance be placed on several days at once. */
  dayPicker?: "single" | "multi";
  onSave: (v: SessionValues) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
  deleteLabel?: string;
  onClose: () => void;
}

const QUICK_DURATIONS = [30, 45, 60, 90];

export default function SessionDialog({ heading, initial, dayPicker, onSave, onDelete, deleteLabel, onClose }: Props) {
  const { domains, domainById, slots, week } = useVault();
  const [title, setTitle] = useState(initial.title);
  const [domainId, setDomainId] = useState<string | null>(initial.domain_id);
  const [start, setStart] = useState(fmtTime(initial.start_min));
  const [end, setEnd] = useState(fmtTime(initial.end_min));
  const [days, setDays] = useState<number[]>(initial.days);
  const [saving, setSaving] = useState(false);

  const startMin = parseTime(start);
  const endMin = parseTime(end);
  const valid = startMin !== null && endMin !== null && endMin > startMin && (!dayPicker || days.length > 0);
  const domain = domainId ? domainById.get(domainId) : undefined;
  const suggestions = useMemo(() => suggestionsFor(domain, slots), [domain, slots]);
  const pickableDays = [...new Set([...week.days, ...initial.days])].sort();

  function toggleDay(d: number) {
    if (dayPicker === "single") setDays([d]);
    else setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));
  }

  async function submit() {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await onSave({ title: title.trim(), domain_id: domainId, start_min: startMin!, end_min: endMin!, days });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      title={heading}
      onClose={onClose}
      className="max-w-lg"
      footer={
        <div className="flex w-full items-center">
          {onDelete && (
            <Button variant="ghost" size="sm" onClick={onDelete} className="mr-auto gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive">
              <Trash2 size={14} />
              {deleteLabel ?? "Supprimer"}
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
            <Button size="sm" onClick={submit} disabled={!valid || saving}>Enregistrer</Button>
          </div>
        </div>
      }
    >
      <form
        className="space-y-5"
        onSubmit={(e) => { e.preventDefault(); void submit(); }}
      >
        {/* Domain */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Domaine</label>
          <div className="grid grid-cols-2 gap-1.5">
            {domains.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setDomainId(d.id)}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors",
                  domainId === d.id ? "border-transparent font-medium text-foreground" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                style={domainId === d.id ? { backgroundColor: withAlpha(d.color, 0.16), boxShadow: `inset 0 0 0 1.5px ${d.color}` } : undefined}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: d.color }} />
                <span className="truncate">{d.name}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => setDomainId(null)}
              className={cn(
                "col-span-2 flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors",
                domainId === null ? "border-foreground/30 bg-muted font-medium text-foreground" : "border-dashed border-border text-muted-foreground hover:bg-muted"
              )}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-muted-foreground/50" />
              Hors domaine <span className="text-xs font-normal text-muted-foreground">— récréation, cantine, accueil… (non compté)</span>
            </button>
          </div>
        </div>

        {/* Title */}
        <div className="space-y-2">
          <label htmlFor="session-title" className="text-xs font-medium text-muted-foreground">Nom de la séance</label>
          <Input
            id="session-title"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={domain ? domain.name : "Récréation"}
            list="session-suggestions"
          />
          <datalist id="session-suggestions">
            {suggestions.map((s) => <option key={s} value={s} />)}
          </datalist>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {suggestions.slice(0, 8).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setTitle(s)}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                    title === s ? "border-primary bg-accent text-accent-foreground" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Days */}
        {dayPicker && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              {dayPicker === "multi" ? "Jours (plusieurs possibles)" : "Jour"}
            </label>
            <div className="flex gap-1.5">
              {pickableDays.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(d)}
                  className={cn(
                    "h-8 min-w-[52px] rounded-md border px-2 text-sm transition-colors",
                    days.includes(d) ? "border-transparent bg-primary font-medium text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {DAY_SHORT[d]}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Times */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Horaire</label>
          <div className="flex flex-wrap items-center gap-2">
            <Input type="time" step={300} value={start} onChange={(e) => setStart(e.target.value)} className="w-28" aria-label="Début" />
            <span className="text-muted-foreground">→</span>
            <Input type="time" step={300} value={end} onChange={(e) => setEnd(e.target.value)} className="w-28" aria-label="Fin" />
            <span className={cn("text-sm", valid || !startMin || !endMin ? "text-muted-foreground" : "text-destructive")}>
              {startMin !== null && endMin !== null
                ? endMin > startMin ? fmtDuration(endMin - startMin) : "fin avant le début"
                : ""}
            </span>
          </div>
          <div className="flex gap-1">
            {QUICK_DURATIONS.map((m) => (
              <button
                key={m}
                type="button"
                disabled={startMin === null}
                onClick={() => startMin !== null && setEnd(fmtTime(Math.min(1440, startMin + m)))}
                className={cn(
                  "rounded-md border px-2 py-0.5 text-[11px] transition-colors disabled:opacity-40",
                  startMin !== null && endMin !== null && endMin - startMin === m
                    ? "border-primary bg-accent text-accent-foreground"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {fmtDuration(m)}
              </button>
            ))}
          </div>
        </div>
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}
