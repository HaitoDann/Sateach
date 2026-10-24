import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Clock, Layers, Plus, Printer, Trash2 } from "lucide-react";
import PageHeader from "../components/PageHeader";
import Attachments from "../components/common/Attachments";
import UndoButton from "../components/common/UndoButton";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { AutoTextarea } from "../components/ui/AutoTextarea";
import { UNDO_EVENT, useVault } from "../context/VaultContext";
import { deleteSequence, getPreps, getSequences, savePrep, saveSequence, type SequenceInput } from "../lib/db";
import { navFocus } from "../lib/nav";
import type { PageName, Prep, Sequence } from "../lib/types";
import { useAutosave } from "../lib/useAutosave";
import { cn } from "../lib/utils";
import { blankPrep } from "./PrepsPage";

type Filter = "all" | string;

export default function SequencesPage({ onNavigate }: { onNavigate: (p: PageName) => void }) {
  const { domains, domainById, confirm, pushUndo } = useVault();
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [preps, setPreps] = useState<Prep[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | null>(() => navFocus.sequenceId);
  // Clear the one-shot focus once mounted (not in the initializer: StrictMode runs it twice).
  useEffect(() => { navFocus.sequenceId = null; }, []);

  const load = useCallback(async () => {
    const [q, p] = await Promise.all([getSequences(), getPreps()]);
    setSequences(q);
    setPreps(p);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onUndo = () => { void load(); };
    window.addEventListener(UNDO_EVENT, onUndo);
    return () => window.removeEventListener(UNDO_EVENT, onUndo);
  }, [load]);

  const visible = sequences.filter((s) => filter === "all" || s.domain_id === filter);
  const byDomain = useMemo(() => {
    const m = new Map<string, Sequence[]>();
    for (const s of visible) { const k = s.domain_id ?? ""; m.set(k, [...(m.get(k) ?? []), s]); }
    return [...m.entries()];
  }, [visible]);
  const count = (f: Filter) => (f === "all" ? sequences.length : sequences.filter((s) => s.domain_id === f).length);

  async function create() {
    const id = await saveSequence({
      domain_id: filter !== "all" ? filter : domains[0]?.id ?? null, title: "Nouvelle séquence", levels: "", nb_sessions: null,
      general_objectives: "", end_of_cycle: "", review: "", period: null,
    });
    await load();
    setSelected(id);
  }

  async function remove(s: Sequence) {
    const ok = await confirm({
      title: "Supprimer la séquence ?",
      message: `« ${s.title} » sera supprimée. Ses fiches de préparation sont conservées (elles passent « hors séquence »).`,
      confirmLabel: "Supprimer",
      destructive: true,
    });
    if (!ok) return;
    const linked = preps.filter((p) => p.sequence_id === s.id);
    await deleteSequence(s.id);
    pushUndo(`Séquence supprimée : ${s.title}`, async () => {
      await saveSequence(s);
      for (const p of linked) await savePrep(p);
    });
    setSelected(null);
    await load();
  }

  const current = sequences.find((s) => s.id === selected) ?? null;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Séquences" subtitle={`${sequences.length} séquence${sequences.length > 1 ? "s" : ""}`}>
        <UndoButton />
        <Button size="sm" className="gap-1.5" onClick={create}><Plus size={15} /> Nouvelle séquence</Button>
      </PageHeader>

      <div className="flex min-h-0 flex-1">
        <nav className="w-72 shrink-0 space-y-0.5 overflow-y-auto border-r border-border px-3 py-4">
          <FilterItem active={filter === "all"} onClick={() => setFilter("all")} label="Toutes" count={count("all")} icon={<Layers size={14} />} />
          <div className="my-2 h-px bg-border" />
          {domains.map((d) => (
            <FilterItem key={d.id} active={filter === d.id} onClick={() => setFilter(d.id)} label={d.name} count={count(d.id)}
              icon={<span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.color }} />} />
          ))}
          <div className="my-3 h-px bg-border" />
          {byDomain.map(([domId, list]) => (
            <div key={domId || "none"} className="mb-3">
              <div className="mb-1 px-2 text-[11px] font-medium text-muted-foreground">{domainById.get(domId)?.name ?? "Sans domaine"}</div>
              {list.map((s) => (
                <button key={s.id} onClick={() => setSelected(s.id)}
                  className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm", selected === s.id ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-muted")}>
                  <span className="min-w-0 flex-1 truncate">{s.title}</span>
                  {s.period && <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] text-muted-foreground">P{s.period}</span>}
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{preps.filter((p) => p.sequence_id === s.id).length}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="min-w-0 flex-1 overflow-y-auto">
          {current ? (
            <SequenceEditor
              key={current.id}
              sequence={current}
              preps={preps.filter((p) => p.sequence_id === current.id).sort((a, b) => (a.number ?? 999) - (b.number ?? 999))}
              onSaved={load}
              onDelete={() => remove(current)}
              onOpenPrep={(id) => { navFocus.prepId = id; onNavigate("preps"); }}
            />
          ) : (
            <div className="mx-auto mt-24 max-w-sm text-center">
              <Layers size={28} className="mx-auto mb-3 text-brand-600" />
              <p className="text-sm text-foreground">Choisissez une séquence, ou créez-en une.</p>
              <p className="mt-1 text-xs text-muted-foreground">Une séquence rassemble ses séances (fiches de préparation), avec ses objectifs et son bilan.</p>
              <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={create}><Plus size={14} /> Nouvelle séquence</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterItem({ active, onClick, label, count, icon }: { active: boolean; onClick: () => void; label: string; count: number; icon: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={cn("flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm transition-colors",
        active ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
      <span className="flex w-4 justify-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-xs tabular-nums opacity-70">{count || ""}</span>
    </button>
  );
}

const summary = (p: Prep) => p.phases.map((ph) => [ph.phase, ph.progression].filter(Boolean).join(" : ")).filter(Boolean).join("\n");

function SequenceEditor({ sequence, preps, onSaved, onDelete, onOpenPrep }: {
  sequence: Sequence; preps: Prep[]; onSaved: () => Promise<void>; onDelete: () => void; onOpenPrep: (id: string) => void;
}) {
  const { domains, domainById } = useVault();
  const [q, setQ] = useState<SequenceInput & { id: string }>(sequence);
  const set = (patch: Partial<Sequence>) => setQ((cur) => ({ ...cur, ...patch }));
  const status = useAutosave(sequence.id, q, async (v) => { await saveSequence(v); await onSaved(); });
  const dom = q.domain_id ? domainById.get(q.domain_id) : undefined;

  async function addSession() {
    const n = Math.max(0, ...preps.map((p) => p.number ?? 0)) + 1;
    const id = await savePrep(blankPrep({ sequence_id: sequence.id, domain_id: q.domain_id, number: n, title: `${q.title} — séance ${n}` }));
    await onSaved();
    onOpenPrep(id);
  }

  const label = "text-xs font-semibold text-foreground";
  const cell = "rounded-none border-0 bg-transparent px-2 py-1.5 text-[13px] shadow-none focus-visible:ring-1";

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <div className="mb-4 flex items-center gap-2">
        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: dom?.color ?? "var(--border)" }} />
        <span className="text-xs text-muted-foreground">Fiche de préparation de séquence</span>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {status === "saving" && <><Clock size={11} /> Enregistrement…</>}
          {status === "saved" && <><Check size={11} className="text-brand-600" /> Enregistré</>}
        </span>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.print()}><Printer size={13} /> Imprimer / PDF</Button>
        <Button variant="ghost" size="sm" className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onDelete}><Trash2 size={13} /> Supprimer</Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="grid grid-cols-[minmax(150px,0.8fr)_2fr_minmax(170px,0.9fr)] border-b border-border bg-muted/50">
          <div className="space-y-1 border-r border-border p-3">
            <div className={label}>Niveaux</div>
            <Input value={q.levels} onChange={(e) => set({ levels: e.target.value })} placeholder="CE1" className="h-8 text-sm" />
          </div>
          <div className="space-y-1 border-r border-border p-3">
            <div className={cn(label, "text-center italic")}>Nom de la séquence</div>
            <Input value={q.title} onChange={(e) => set({ title: e.target.value })} className="h-9 text-center text-base font-medium" aria-label="Nom de la séquence" />
          </div>
          <div className="space-y-2 p-3 text-xs">
            <label className="flex items-center gap-2">
              <span className={cn(label, "w-24")}>Nombre de séances</span>
              <Input type="number" min={1} value={q.nb_sessions ?? ""} onChange={(e) => set({ nb_sessions: e.target.value ? Number(e.target.value) : null })} className="h-7 w-14 px-2 text-xs" />
            </label>
            <label className="flex items-center gap-2">
              <span className={cn(label, "w-24")}>Période</span>
              <Select value={q.period ?? ""} onChange={(e) => set({ period: e.target.value ? Number(e.target.value) : null })} className="h-7 w-24 text-xs">
                <option value="">—</option>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>Période {n}</option>)}
              </Select>
            </label>
          </div>
        </div>
        <div className="flex items-center gap-3 border-b border-border px-3 py-2">
          <span className={label}>Domaine :</span>
          <Select value={q.domain_id ?? ""} onChange={(e) => set({ domain_id: e.target.value || null })} className="h-7 w-60 text-xs">
            <option value="">Sans domaine</option>
            {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </div>
        <div className="border-b border-border px-3 pt-2">
          <div className={cn(label, "underline")}>Objectifs généraux :</div>
          <div className="-mx-1 pb-1"><AutoTextarea value={q.general_objectives} onChange={(v) => set({ general_objectives: v })} minRows={2} className={cell} label="Objectifs généraux" /></div>
        </div>
        <div className="border-b border-border px-3 pt-2">
          <div className={cn(label, "underline")}>Attendus de fin de cycle :</div>
          <div className="-mx-1 pb-1"><AutoTextarea value={q.end_of_cycle} onChange={(v) => set({ end_of_cycle: v })} minRows={2} className={cell} label="Attendus de fin de cycle" /></div>
        </div>

        {/* Séances of the séquence = its fiches de préparation */}
        <div className="grid grid-cols-[1.3fr_0.5fr_1.4fr_1.1fr_2.2fr_1.2fr] border-b border-border bg-muted/50 text-center text-xs font-semibold text-foreground">
          {["Séance", "Durée (min)", "Objectifs", "Matériel / organisation", "Déroulement", "Remarques / bilan"].map((h) => (
            <div key={h} className="border-r border-border px-2 py-2 last:border-r-0">{h}</div>
          ))}
        </div>
        {preps.map((p) => (
          <button key={p.id} onClick={() => onOpenPrep(p.id)} title="Ouvrir la fiche de préparation"
            className="grid w-full grid-cols-[1.3fr_0.5fr_1.4fr_1.1fr_2.2fr_1.2fr] border-b border-border text-left text-[12px] transition-colors hover:bg-accent/50">
            <div className="border-r border-border px-2 py-1.5 font-medium text-foreground">{p.number ? `${p.number}. ` : ""}{p.title}</div>
            <div className="border-r border-border px-2 py-1.5 text-center tabular-nums">{p.duration_min ?? ""}</div>
            <div className="line-clamp-4 whitespace-pre-line border-r border-border px-2 py-1.5 text-muted-foreground">{p.objective}</div>
            <div className="line-clamp-4 whitespace-pre-line border-r border-border px-2 py-1.5 text-muted-foreground">{[p.materials, p.organisation].filter(Boolean).join("\n")}</div>
            <div className="line-clamp-4 whitespace-pre-line border-r border-border px-2 py-1.5 text-muted-foreground">{summary(p)}</div>
            <div className="line-clamp-4 whitespace-pre-line px-2 py-1.5 text-muted-foreground">{p.review}</div>
          </button>
        ))}
        <button onClick={addSession} className="flex w-full items-center justify-center gap-1.5 border-b border-border py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
          <Plus size={13} /> Ajouter une séance (crée sa fiche de préparation)
        </button>
        <div className="px-3 pt-2">
          <div className={cn(label, "underline")}>Bilan de la séquence :</div>
          <div className="-mx-1 pb-1"><AutoTextarea value={q.review} onChange={(v) => set({ review: v })} minRows={3} className={cell} label="Bilan de la séquence" /></div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-border bg-card p-4"><Attachments ownerType="sequence" ownerId={sequence.id} /></div>

      <SequencePrint sequence={{ ...sequence, ...q }} preps={preps} domainName={dom?.name} color={dom?.color} />
    </div>
  );
}

function SequencePrint({ sequence, preps, domainName, color }: { sequence: Sequence; preps: Prep[]; domainName?: string; color?: string }) {
  const b = "1px solid #444";
  const th: React.CSSProperties = { border: b, background: "#e8e8e8", padding: "4px 6px", fontWeight: 600, textAlign: "center" };
  const td: React.CSSProperties = { border: b, padding: "4px 6px", verticalAlign: "top", whiteSpace: "pre-wrap" };
  const rows = preps.length ? preps : [];
  return createPortal(
    <div className="print-root print-landscape" style={{ fontFamily: '"Onest Variable", system-ui, sans-serif', fontSize: 10, color: "#111" }}>
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <span style={{ display: "inline-block", border: "1.5px solid #111", borderRadius: 4, padding: "3px 14px", fontWeight: 600, fontSize: 13 }}>Fiche de préparation de séquence</span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <colgroup><col style={{ width: "13%" }} /><col style={{ width: "7%" }} /><col style={{ width: "16%" }} /><col style={{ width: "13%" }} /><col style={{ width: "36%" }} /><col style={{ width: "15%" }} /></colgroup>
        <tbody>
          <tr>
            <td style={{ ...th, textAlign: "left" }}>Niveaux : <span style={{ fontWeight: 400 }}>{sequence.levels}</span></td>
            <td style={{ ...th, fontStyle: "italic" }} colSpan={4}>{sequence.title}</td>
            <td style={th}>Nombre de séances : {sequence.nb_sessions ?? preps.length}</td>
          </tr>
          <tr><td style={td} colSpan={6}><b>Domaine :</b> <span style={{ color }}>{domainName ?? ""}</span>{sequence.period ? ` · Période ${sequence.period}` : ""}</td></tr>
          <tr><td style={td} colSpan={6}><b><u>Objectifs généraux</u> :</b> {sequence.general_objectives}</td></tr>
          <tr><td style={td} colSpan={6}><b><u>Attendus de fin de cycle</u> :</b> {sequence.end_of_cycle}</td></tr>
          <tr>
            <td style={th}>Séance</td><td style={th}>Durée (minutes)</td><td style={th}>Objectifs</td>
            <td style={th}>Matériel / organisation</td><td style={th}>Déroulement</td><td style={th}>Remarques / bilan</td>
          </tr>
          {rows.map((p) => (
            <tr key={p.id} className="print-break-avoid">
              <td style={td}>{p.number ? `${p.number}. ` : ""}{p.title}</td><td style={{ ...td, textAlign: "center" }}>{p.duration_min ?? ""}</td>
              <td style={td}>{p.objective}</td><td style={td}>{[p.materials, p.organisation].filter(Boolean).join("\n")}</td>
              <td style={td}>{summary(p)}</td><td style={td}>{p.review}</td>
            </tr>
          ))}
          {rows.length === 0 && Array.from({ length: 5 }, (_, i) => <tr key={i}>{Array.from({ length: 6 }, (_, j) => <td key={j} style={{ ...td, height: 18 }} />)}</tr>)}
        </tbody>
      </table>
      <div style={{ marginTop: 10, whiteSpace: "pre-wrap" }}><u>Bilan de la séquence</u> : {sequence.review}</div>
    </div>,
    document.body
  );
}

