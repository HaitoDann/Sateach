import { useState } from "react";
import { Plus, MousePointerClick } from "lucide-react";
import PageHeader from "../components/PageHeader";
import WeekGrid from "../components/timetable/WeekGrid";
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

      {/* Legend: every domain with its weekly hours */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 px-6 py-3">
        {volumes.map(({ domain, planned }) => (
          <div key={domain.id} className="flex items-center gap-1.5 text-xs">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: domain.color }} />
            <span className="text-foreground">{domain.name}</span>
            <span className="tabular-nums text-muted-foreground">{planned ? fmtDuration(planned) : "—"}</span>
          </div>
        ))}
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
          />
        )}
        {visibleSlots.length === 0 && week.days.length > 0 && (
          <div className="pointer-events-none absolute inset-x-6 top-1/2 flex -translate-y-1/2 justify-center">
            <div className="flex items-center gap-2 rounded-full border border-border bg-card/95 px-4 py-2 text-sm text-muted-foreground shadow-sm">
              <MousePointerClick size={15} className="text-brand-600" />
              Cliquez ou glissez dans la grille pour placer votre première séance
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
