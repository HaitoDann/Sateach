import { useState } from "react";
import { Plus, MousePointerClick, GripVertical } from "lucide-react";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import PageHeader from "../components/PageHeader";
import WeekGrid, { pastilleDrag } from "../components/timetable/WeekGrid";
import { withAlpha } from "../lib/utils";
import SessionDialog, { type SessionValues } from "../components/SessionDialog";
import { Button } from "../components/ui/Button";
import { useVault } from "../context/VaultContext";
import { createSlot, deleteSlot, updateSlot } from "../lib/db";
import { computeVolumes } from "../lib/domains";
import { fmtDuration } from "../lib/time";
import type { Slot } from "../lib/types";

type Editing = { kind: "new"; initial: SessionValues } | { kind: "edit"; slot: Slot };

export default function TimetablePage() {
  const { domains, domainById, slots, week, reload, toast, confirm } = useVault();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [lastDomain, setLastDomain] = useState<string | null>(null);
  const [dropDuration, setDropDuration] = useState(45);

  const volumes = computeVolumes(domains, slots, week.days);
  const total = volumes.reduce((a, v) => a + v.planned, 0);
  const visibleSlots = slots.filter((s) => week.days.includes(s.day));

  function openNew(day: number, start: number, end: number) {
    setEditing({
      kind: "new",
      initial: { title: "", domain_id: lastDomain ?? domains[0]?.id ?? null, start_min: start, end_min: end, days: [day] },
    });
  }

  async function save(v: SessionValues) {
    try {
      if (editing?.kind === "edit") {
        await updateSlot(editing.slot.id, { title: v.title, domain_id: v.domain_id, start_min: v.start_min, end_min: v.end_min, day: v.days[0] });
      } else {
        for (const day of v.days) {
          await createSlot({ title: v.title, domain_id: v.domain_id, start_min: v.start_min, end_min: v.end_min, day });
        }
        if (v.days.length > 1) toast(`Séance ajoutée sur ${v.days.length} jours`);
      }
      setLastDomain(v.domain_id);
      setEditing(null);
      await reload();
    } catch (e) {
      toast(`Enregistrement impossible : ${e}`, "error");
    }
  }

  async function remove(slot: Slot) {
    const ok = await confirm({
      title: "Supprimer la séance ?",
      message: "Elle disparaît de l'emploi du temps. Ce que vous avez déjà écrit dans le cahier journal pour cette séance est conservé.",
      confirmLabel: "Supprimer",
      destructive: true,
    });
    if (!ok) return;
    await deleteSlot(slot.id);
    setEditing(null);
    await reload();
  }

  async function dropDomain(domainId: string | null, day: number, start: number, end: number) {
    await createSlot({ day, start_min: start, end_min: end, domain_id: domainId, title: domainId ? "" : "Récréation" });
    setLastDomain(domainId);
    await reload();
  }

  async function move(id: string, patch: Pick<Slot, "day" | "start_min" | "end_min">) {
    await updateSlot(id, patch);
    await reload();
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Emploi du temps" subtitle={`${fmtDuration(total)} d'enseignement par semaine`}>
        <Button size="sm" className="gap-1.5" onClick={() => openNew(week.days[0] ?? 0, 8 * 60 + 30, 9 * 60 + 15)}>
          <Plus size={15} />
          Nouvelle séance
        </Button>
      </PageHeader>

      {/* Pastilles: drag one onto the grid to create a séance instantly */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-6 py-3">
        {volumes.map(({ domain, planned }) => (
          <Pastille key={domain.id} domainId={domain.id} duration={dropDuration} label={domain.name} color={domain.color} hint={planned ? fmtDuration(planned) : "—"} />
        ))}
        <Pastille domainId={null} duration={Math.min(dropDuration, 15)} label="Pause" hint="hors domaine" />
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <GripVertical size={13} className="opacity-60" />
          Glissez une pastille dans la grille · durée
          <SegmentedControl
            options={[30, 45, 60].map((m) => ({ value: String(m), label: fmtDuration(m) }))}
            value={String(dropDuration)}
            onChange={(v) => setDropDuration(Number(v))}
          />
        </div>
      </div>

      <div className="relative min-h-0 flex-1 px-6 pb-6">
        {week.days.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
            Aucun jour de classe n'est activé — choisissez-les dans les Réglages.
          </div>
        ) : (
          <WeekGrid
            days={week.days}
            dayStart={week.dayStart}
            dayEnd={week.dayEnd}
            slots={visibleSlots}
            domainById={domainById}
            onCreate={openNew}
            onEdit={(slot) => setEditing({ kind: "edit", slot })}
            onChange={move}
            onDropDomain={dropDomain}
          />
        )}
        {visibleSlots.length === 0 && week.days.length > 0 && (
          <div className="pointer-events-none absolute inset-x-6 top-1/2 flex -translate-y-1/2 justify-center">
            <div className="flex items-center gap-2 rounded-full border border-border bg-card/95 px-4 py-2 text-sm text-muted-foreground shadow-sm">
              <MousePointerClick size={15} className="text-brand-600" />
              Glissez une pastille de domaine dans la grille, ou cliquez-glissez pour créer une séance
            </div>
          </div>
        )}
      </div>

      {editing && (
        <SessionDialog
          heading={editing.kind === "edit" ? "Modifier la séance" : "Nouvelle séance"}
          initial={
            editing.kind === "edit"
              ? { title: editing.slot.title, domain_id: editing.slot.domain_id, start_min: editing.slot.start_min, end_min: editing.slot.end_min, days: [editing.slot.day] }
              : editing.initial
          }
          dayPicker={editing.kind === "edit" ? "single" : "multi"}
          onSave={save}
          onDelete={editing.kind === "edit" ? () => remove(editing.slot) : undefined}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function Pastille({ domainId, duration, label, color, hint }: { domainId: string | null; duration: number; label: string; color?: string; hint: string }) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        pastilleDrag.domainId = domainId;
        pastilleDrag.duration = duration;
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData("text/plain", label);
      }}
      onDragEnd={() => { pastilleDrag.domainId = undefined; }}
      title={`Glisser dans l'emploi du temps pour créer une séance de ${label}`}
      className="flex cursor-grab select-none items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-transform duration-150 ease-aqua hover:-translate-y-0.5 hover:shadow-sm active:cursor-grabbing"
      style={
        color
          ? { backgroundColor: withAlpha(color, 0.12), borderColor: withAlpha(color, 0.35) }
          : { borderStyle: "dashed", borderColor: "var(--border)" }
      }
    >
      <span className="h-2.5 w-2.5 rounded-full" style={color ? { backgroundColor: color } : { border: "1px solid var(--muted-foreground)" }} />
      <span className="font-medium text-foreground">{label}</span>
      <span className="tabular-nums text-muted-foreground">{hint}</span>
    </div>
  );
}
