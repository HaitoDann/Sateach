import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Check, Minus, Plus, RotateCcw } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { Button } from "../components/ui/Button";
import { useVault } from "../context/VaultContext";
import { setDomainTargets, updateDomain } from "../lib/db";
import { DEFAULT_DOMAINS, computeVolumes, type DomainVolume } from "../lib/domains";
import { fmtDuration, fmtHours, parseDuration } from "../lib/time";
import { cn } from "../lib/utils";

export default function VolumesPage() {
  const { domains, slots, week, reload, confirm, toast } = useVault();
  const volumes = computeVolumes(domains, slots, week.days);
  const planned = volumes.reduce((a, v) => a + v.planned, 0);
  const target = volumes.reduce((a, v) => a + v.target, 0);
  const toAdjust = volumes.filter((v) => v.status === "over" || v.status === "under").length;
  const scale = Math.max(60, ...volumes.map((v) => Math.max(v.planned, v.target)));

  async function setTarget(id: string, minutes: number) {
    await updateDomain(id, { target_minutes: Math.max(0, Math.min(40 * 60, minutes)) });
    await reload();
  }

  async function applyOfficial() {
    const ok = await confirm({
      title: "Appliquer les horaires du cycle 2 ?",
      message:
        "Les volumes de référence seront remplacés par les horaires indicatifs du cycle 2 (24h : Français 10h, Mathématiques 5h, EPS 3h, Questionner le monde 2h, Anglais 1h30, Arts plastiques 1h, Musique 1h, EMC 0h30). Seuls les domaines portant ces noms sont modifiés.",
      confirmLabel: "Appliquer",
    });
    if (!ok) return;
    const byName = new Map(DEFAULT_DOMAINS.map((d) => [d.name.toLowerCase(), d.target_minutes]));
    await setDomainTargets(
      domains.filter((d) => byName.has(d.name.toLowerCase())).map((d) => ({ id: d.id, target_minutes: byName.get(d.name.toLowerCase())! }))
    );
    await reload();
    toast("Horaires de référence mis à jour");
  }

  const gap = planned - target;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Volume horaire" subtitle="Ce que prévoit votre emploi du temps, domaine par domaine">
        <Button variant="outline" size="sm" className="gap-1.5" onClick={applyOfficial}>
          <RotateCcw size={14} />
          Horaires officiels cycle 2
        </Button>
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-6 px-6 py-6">
          {/* Headline numbers */}
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Prévu par semaine" value={fmtHours(planned)} hint={`sur ${week.days.length} jour${week.days.length > 1 ? "s" : ""} de classe`} />
            <Stat label="Volume de référence" value={fmtHours(target)} hint="somme de vos objectifs" />
            <Stat
              label="Écart"
              value={gap === 0 ? "0h00" : `${gap > 0 ? "+" : ""}${fmtHours(gap)}`}
              hint={toAdjust === 0 ? "tous les domaines sont conformes" : `${toAdjust} domaine${toAdjust > 1 ? "s" : ""} à ajuster`}
            />
          </div>

          {/* Week composition */}
          {planned > 0 && (
            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-3 text-sm font-medium text-foreground">Répartition de la semaine</h2>
              <div className="flex h-5 gap-[2px] rounded-md">
                {volumes.filter((v) => v.planned > 0).map((v) => {
                  const pct = (v.planned / planned) * 100;
                  return (
                    <div
                      key={v.domain.id}
                      className="group relative first:rounded-l-md last:rounded-r-md"
                      style={{ width: `${pct}%`, backgroundColor: v.domain.color }}
                    >
                      <Tip>{v.domain.name} · {fmtDuration(v.planned)} · {Math.round(pct)}%</Tip>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                {volumes.filter((v) => v.planned > 0).map((v) => (
                  <span key={v.domain.id} className="flex items-center gap-1.5 text-xs text-foreground">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: v.domain.color }} />
                    {v.domain.name}
                    <span className="text-muted-foreground">{Math.round((v.planned / planned) * 100)}%</span>
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Per domain */}
          <section className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <h2 className="text-sm font-medium text-foreground">Par domaine</h2>
              <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-sm bg-muted-foreground/50" /> prévu</span>
                <span className="flex items-center gap-1.5"><span className="h-3 w-0.5 rounded bg-foreground" /> référence</span>
              </div>
            </div>
            <div className="grid grid-cols-[minmax(150px,1.1fr)_minmax(160px,2fr)_64px_128px_156px] items-center gap-x-4 px-5 pt-2 text-[11px] font-medium text-muted-foreground">
              <span>Domaine</span>
              <span />
              <span className="text-right">Prévu</span>
              <span className="text-center">Référence / sem.</span>
              <span>Écart</span>
            </div>
            <div className="px-5 pb-3">
              {volumes.map((v, i) => (
                <Row key={v.domain.id} v={v} scale={scale} index={i} onTarget={(m) => setTarget(v.domain.id, m)} />
              ))}
            </div>
          </section>

          <p className="text-xs text-muted-foreground">
            Le « prévu » additionne les séances de l'emploi du temps sur vos jours de classe. Les temps hors domaine (récréation,
            cantine, accueil…) ne sont pas comptés. Un écart de 15 minutes ou moins est considéré comme conforme.
          </p>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-5 py-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
      {children}
    </span>
  );
}

function Row({ v, scale, index, onTarget }: { v: DomainVolume; scale: number; index: number; onTarget: (m: number) => void }) {
  const { domain, planned, target, delta, status } = v;
  return (
    <div
      className="grid grid-cols-[minmax(150px,1.1fr)_minmax(160px,2fr)_64px_128px_156px] items-center gap-x-4 border-b border-border/60 py-2.5 last:border-b-0 animate-item-in"
      style={{ animationDelay: `${index * 30}ms` }}
    >
      <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: domain.color }} />
        <span className="truncate">{domain.name}</span>
      </span>

      {/* Bar: planned (filled) against the reference (tick) */}
      <div className="group relative h-6">
        <div className="absolute inset-y-1.5 left-0 right-0 rounded bg-muted" />
        <div
          className="absolute inset-y-1.5 left-0 rounded transition-[width] duration-500 ease-aqua"
          style={{ width: `${(planned / scale) * 100}%`, backgroundColor: domain.color }}
        />
        {target > 0 && (
          <div className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded bg-foreground" style={{ left: `${(target / scale) * 100}%` }} />
        )}
        <Tip>
          {domain.name} · prévu {fmtDuration(planned)}{target > 0 ? ` / référence ${fmtDuration(target)}` : ""}
        </Tip>
      </div>

      <span className="text-right text-sm tabular-nums text-foreground">{fmtHours(planned)}</span>
      <DurationInput value={target} onChange={onTarget} label={`Référence ${domain.name}`} />
      <StatusChip status={status} delta={delta} />
    </div>
  );
}

function StatusChip({ status, delta }: { status: DomainVolume["status"]; delta: number }) {
  if (status === "none") return <span className="text-xs text-muted-foreground">pas d'objectif</span>;
  if (status === "ok") {
    return (
      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
        <Check size={12} /> conforme
      </span>
    );
  }
  const over = status === "over";
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        over ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" : "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300"
      )}
      title={over ? "Plus d'heures que la référence" : "Moins d'heures que la référence"}
    >
      {over ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
      {over ? "+" : ""}{fmtHours(delta)} {over ? "en trop" : "manquant"}
    </span>
  );
}

/** "5h30"-style editable duration with ±15 min steppers. */
function DurationInput({ value, onChange, label }: { value: number; onChange: (m: number) => void; label: string }) {
  const [text, setText] = useState(fmtHours(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setText(fmtHours(value)); setInvalid(false); }, [value]);

  function commit() {
    const m = parseDuration(text);
    if (m === null) { setInvalid(true); return; }
    setInvalid(false);
    if (m !== value) onChange(m);
    else setText(fmtHours(value));
  }

  const step = "flex h-7 w-6 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40";
  return (
    <div className={cn("flex h-7 items-center overflow-hidden rounded-md border bg-background", invalid ? "border-destructive" : "border-input")}>
      <button className={step} onClick={() => onChange(Math.max(0, value - 15))} disabled={value <= 0} aria-label="Moins 15 minutes">
        <Minus size={12} />
      </button>
      <input
        value={text}
        aria-label={label}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="h-full w-0 flex-1 bg-transparent text-center text-sm tabular-nums text-foreground focus:outline-none"
      />
      <button className={step} onClick={() => onChange(value + 15)} aria-label="Plus 15 minutes">
        <Plus size={12} />
      </button>
    </div>
  );
}
