import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, Check, Clock, CopyPlus, FileText, Layers, Plus, Printer, Search, Trash2, X } from "lucide-react";
import PageHeader from "../components/PageHeader";
import Attachments from "../components/common/Attachments";
import UndoButton from "../components/common/UndoButton";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { AutoTextarea } from "../components/ui/AutoTextarea";
import { UNDO_EVENT, useVault } from "../context/VaultContext";
import { addAttachment, deletePrep, getAttachments, getPrep, getPrepUsages, getPreps, getSequences, relinkPrep, savePrep, type PrepInput } from "../lib/db";
import { navFocus } from "../lib/nav";
import { fromDateKey } from "../lib/time";
import type { PageName, Prep, PrepPhase, Sequence } from "../lib/types";
import { useAutosave } from "../lib/useAutosave";
import { cn } from "../lib/utils";

const EMPTY_PHASE: PrepPhase = { phase: "", duration: "", materials: "", progression: "", students: "" };

export function blankPrep(over: Partial<PrepInput> = {}): PrepInput {
  return {
    sequence_id: null, domain_id: null, title: "Nouvelle séance", number: null, duration_min: 45,
    objective: "", skills: "", materials: "", organisation: "",
    phases: [{ ...EMPTY_PHASE, phase: "Découverte" }, { ...EMPTY_PHASE, phase: "Recherche" }, { ...EMPTY_PHASE, phase: "Mise en commun" }, { ...EMPTY_PHASE, phase: "Institutionnalisation" }],
    review: "", ...over,
  };
}

export default function PrepsPage({ onNavigate }: { onNavigate: (p: PageName) => void }) {
  const { domains, domainById, toast, confirm, pushUndo } = useVault();
  const [preps, setPreps] = useState<Prep[]>([]);
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [selected, setSelected] = useState<string | null>(() => navFocus.prepId);
  // Clear the one-shot focus once mounted (not in the initializer: StrictMode runs it twice).
  useEffect(() => { navFocus.prepId = null; }, []);
  const [query, setQuery] = useState("");
  const [domainFilter, setDomainFilter] = useState("");

  const load = useCallback(async () => {
    const [p, q] = await Promise.all([getPreps(), getSequences()]);
    setPreps(p);
    setSequences(q);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onUndo = () => { void load(); };
    window.addEventListener(UNDO_EVENT, onUndo);
    return () => window.removeEventListener(UNDO_EVENT, onUndo);
  }, [load]);

  const seqById = useMemo(() => new Map(sequences.map((s) => [s.id, s])), [sequences]);
  const q = query.trim().toLowerCase();
  const visible = preps.filter((p) =>
    (!domainFilter || p.domain_id === domainFilter) &&
    (!q || [p.title, p.objective, p.skills, seqById.get(p.sequence_id ?? "")?.title ?? ""].some((t) => t.toLowerCase().includes(q)))
  );
  const groups = useMemo(() => {
    const m = new Map<string, Prep[]>();
    for (const p of visible) {
      const k = p.sequence_id && seqById.has(p.sequence_id) ? p.sequence_id : "";
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return [...m.entries()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : (seqById.get(a)!.title).localeCompare(seqById.get(b)!.title, "fr")));
  }, [visible, seqById]);

  async function create() {
    const id = await savePrep(blankPrep({ domain_id: domainFilter || domains[0]?.id || null }));
    await load();
    setSelected(id);
  }

  async function duplicate(p: Prep) {
    const id = await savePrep({ ...p, id: undefined, title: `${p.title} (copie)` });
    for (const a of await getAttachments("prep", p.id)) await addAttachment("prep", id, a.name, a.rel_path);
    await load();
    setSelected(id);
    toast("Fiche dupliquée");
  }

  async function remove(p: Prep) {
    const ok = await confirm({
      title: "Supprimer cette fiche ?",
      message: `« ${p.title} » sera supprimée. Les séances du cahier journal qui l'utilisaient sont conservées (sans fiche).`,
      confirmLabel: "Supprimer",
      destructive: true,
    });
    if (!ok) return;
    const usages = (await getPrepUsages(p.id)).map((u) => u.id);
    await deletePrep(p.id);
    pushUndo(`Fiche supprimée : ${p.title}`, async () => { await savePrep(p); await relinkPrep(p.id, usages); });
    setSelected(null);
    await load();
  }

  const current = preps.find((p) => p.id === selected) ?? null;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Fiches de préparation" subtitle={`${preps.length} fiche${preps.length > 1 ? "s" : ""}`}>
        <UndoButton />
        <Button size="sm" className="gap-1.5" onClick={create}><Plus size={15} /> Nouvelle fiche</Button>
      </PageHeader>

      <div className="flex min-h-0 flex-1">
        {/* List */}
        <nav className="flex w-72 shrink-0 flex-col border-r border-border">
          <div className="space-y-2 border-b border-border p-3">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher…"
                className="h-8 w-full rounded-md border border-border bg-muted/40 pl-8 pr-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
            </div>
            <Select value={domainFilter} onChange={(e) => setDomainFilter(e.target.value)} className="h-8 text-xs">
              <option value="">Tous les domaines</option>
              {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto p-2">
            {visible.length === 0 && <p className="px-2 py-6 text-center text-xs text-muted-foreground">Aucune fiche. Créez-en une, ou depuis le cahier journal : menu ⋯ d'une séance › « Créer la fiche de préparation ».</p>}
            {groups.map(([seqId, list]) => (
              <div key={seqId || "none"}>
                <div className="mb-1 flex items-center gap-1.5 px-2 text-[11px] font-medium text-muted-foreground">
                  <Layers size={11} /> {seqId ? seqById.get(seqId)!.title : "Hors séquence"}
                </div>
                {list.map((p) => {
                  const dom = p.domain_id ? domainById.get(p.domain_id) : undefined;
                  return (
                    <button key={p.id} onClick={() => setSelected(p.id)}
                      className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                        selected === p.id ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-muted")}>
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: dom?.color ?? "var(--border)" }} />
                      <span className="min-w-0 flex-1 truncate">{p.number ? `${p.number}. ` : ""}{p.title}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </nav>

        {/* Editor */}
        <div className="min-w-0 flex-1 overflow-y-auto">
          {current ? (
            <PrepEditor
              key={current.id}
              prep={current}
              sequences={sequences}
              onSaved={load}
              onDuplicate={() => duplicate(current)}
              onDelete={() => remove(current)}
              onOpenSequence={(id) => { navFocus.sequenceId = id; onNavigate("sequences"); }}
              onOpenJournal={() => onNavigate("journal")}
            />
          ) : (
            <div className="mx-auto mt-24 max-w-sm text-center">
              <FileText size={28} className="mx-auto mb-3 text-brand-600" />
              <p className="text-sm text-foreground">Choisissez une fiche à gauche, ou créez-en une.</p>
              <p className="mt-1 text-xs text-muted-foreground">Le modèle reprend la fiche de préparation de séance : objectif, compétences, matériel, organisation, phases, bilan.</p>
              <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={create}><Plus size={14} /> Nouvelle fiche</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PrepEditor({ prep, sequences, onSaved, onDuplicate, onDelete, onOpenSequence, onOpenJournal }: {
  prep: Prep; sequences: Sequence[]; onSaved: () => Promise<void>; onDuplicate: () => void; onDelete: () => void;
  onOpenSequence: (id: string) => void; onOpenJournal: () => void;
}) {
  const { domains, domainById } = useVault();
  const [p, setP] = useState<Prep>(prep);
  const [usages, setUsages] = useState<{ date: string; done: number }[]>([]);
  const set = (patch: Partial<Prep>) => setP((cur) => ({ ...cur, ...patch }));
  const status = useAutosave(prep.id, p, async (v) => { await savePrep(v); await onSaved(); });

  useEffect(() => { void getPrepUsages(prep.id).then(setUsages); }, [prep.id]);
  // Reflect an undo (the stored fiche changed under us).
  useEffect(() => {
    const onUndo = () => { void getPrep(prep.id).then((fresh) => { if (fresh) setP(fresh); }); };
    window.addEventListener(UNDO_EVENT, onUndo);
    return () => window.removeEventListener(UNDO_EVENT, onUndo);
  }, [prep.id]);

  const seq = sequences.find((s) => s.id === p.sequence_id);
  const dom = p.domain_id ? domainById.get(p.domain_id) : undefined;

  function setPhase(i: number, patch: Partial<PrepPhase>) {
    set({ phases: p.phases.map((ph, j) => (j === i ? { ...ph, ...patch } : ph)) });
  }
  function movePhase(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= p.phases.length) return;
    const next = [...p.phases];
    [next[i], next[j]] = [next[j], next[i]];
    set({ phases: next });
  }

  const label = "text-xs font-semibold text-foreground";
  const cell = "rounded-none border-0 bg-transparent px-2 py-1.5 text-[13px] shadow-none focus-visible:ring-1";

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <div className="mb-4 flex items-center gap-2">
        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: dom?.color ?? "var(--border)" }} />
        <span className="text-xs text-muted-foreground">Fiche de préparation de séance</span>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {status === "saving" && <><Clock size={11} /> Enregistrement…</>}
          {status === "saved" && <><Check size={11} className="text-brand-600" /> Enregistré</>}
        </span>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.print()}><Printer size={13} /> Imprimer / PDF</Button>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={onDuplicate}><CopyPlus size={13} /> Dupliquer</Button>
        <Button variant="ghost" size="sm" className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onDelete}><Trash2 size={13} /> Supprimer</Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {/* Header row, as on the paper template */}
        <div className="grid grid-cols-[minmax(180px,1fr)_2fr_minmax(170px,0.9fr)] border-b border-border bg-muted/50">
          <div className="space-y-1 border-r border-border p-3">
            <div className={label}>Séquence</div>
            <Select value={p.sequence_id ?? ""} onChange={(e) => {
              const sq = sequences.find((s) => s.id === e.target.value);
              set({ sequence_id: e.target.value || null, domain_id: sq?.domain_id ?? p.domain_id });
            }} className="h-8 text-xs">
              <option value="">Aucune</option>
              {sequences.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </Select>
            {seq && <button onClick={() => onOpenSequence(seq.id)} className="text-[11px] text-brand-700 hover:underline dark:text-brand-300">Voir la séquence →</button>}
          </div>
          <div className="space-y-1 border-r border-border p-3">
            <div className={cn(label, "text-center")}>Nom de la séance</div>
            <Input value={p.title} onChange={(e) => set({ title: e.target.value })} className="h-9 text-center text-base font-medium" aria-label="Nom de la séance" />
            <Select value={p.domain_id ?? ""} onChange={(e) => set({ domain_id: e.target.value || null })} className="h-7 text-xs">
              <option value="">Sans domaine</option>
              {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </div>
          <div className="space-y-2 p-3 text-xs">
            <label className="flex items-center gap-2">
              <span className={cn(label, "w-14")}>Séance</span>
              <Input type="number" min={1} value={p.number ?? ""} onChange={(e) => set({ number: e.target.value ? Number(e.target.value) : null })} className="h-7 w-14 px-2 text-xs" />
              <span className="text-muted-foreground">/ {seq?.nb_sessions ?? "…"}</span>
            </label>
            <label className="flex items-center gap-2">
              <span className={cn(label, "w-14")}>Durée</span>
              <Input type="number" min={5} step={5} value={p.duration_min ?? ""} onChange={(e) => set({ duration_min: e.target.value ? Number(e.target.value) : null })} className="h-7 w-16 px-2 text-xs" />
              <span className="text-muted-foreground">min</span>
            </label>
          </div>
        </div>

        <Block title="Objectif de la séance"><AutoTextarea value={p.objective} onChange={(v) => set({ objective: v })} minRows={2} className={cell} label="Objectif" placeholder="À la fin de la séance, l'élève est capable de…" /></Block>
        <Block title="Compétences travaillées"><AutoTextarea value={p.skills} onChange={(v) => set({ skills: v })} minRows={2} className={cell} label="Compétences" placeholder="Compétences du programme / du socle…" /></Block>
        <div className="grid grid-cols-2 border-b border-border">
          <div className="border-r border-border"><Block title="Matériel" bare><AutoTextarea value={p.materials} onChange={(v) => set({ materials: v })} minRows={2} className={cell} label="Matériel" /></Block></div>
          <Block title="Organisation" bare><AutoTextarea value={p.organisation} onChange={(v) => set({ organisation: v })} minRows={2} className={cell} label="Organisation" placeholder="Collectif, groupes, binômes, individuel…" /></Block>
        </div>

        {/* Phases */}
        <div className="grid grid-cols-[1fr_1.1fr_1fr_2.4fr_1.6fr_auto] border-b border-border bg-muted/50 text-center text-xs font-semibold text-foreground">
          {["Phase", "Durée et organisation", "Matériel", "Déroulement + consignes", "Activité des élèves et différenciation"].map((h) => (
            <div key={h} className="border-r border-border px-2 py-2">{h}</div>
          ))}
          <div className="w-16" />
        </div>
        {p.phases.map((ph, i) => (
          <div key={i} className="group grid grid-cols-[1fr_1.1fr_1fr_2.4fr_1.6fr_auto] border-b border-border">
            {(["phase", "duration", "materials", "progression", "students"] as (keyof PrepPhase)[]).map((k) => (
              <div key={k} className="border-r border-border">
                <AutoTextarea value={ph[k]} onChange={(v) => setPhase(i, { [k]: v })} minRows={1} className={cell} label={k} />
              </div>
            ))}
            <div className="flex w-16 items-start justify-center gap-0.5 pt-1 opacity-0 transition-opacity group-hover:opacity-100">
              <button onClick={() => movePhase(i, -1)} className="rounded p-0.5 text-muted-foreground hover:bg-muted" title="Monter"><ArrowUp size={12} /></button>
              <button onClick={() => movePhase(i, 1)} className="rounded p-0.5 text-muted-foreground hover:bg-muted" title="Descendre"><ArrowDown size={12} /></button>
              <button onClick={() => set({ phases: p.phases.filter((_, j) => j !== i) })} className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Supprimer la ligne"><X size={12} /></button>
            </div>
          </div>
        ))}
        <button onClick={() => set({ phases: [...p.phases, { ...EMPTY_PHASE }] })}
          className="flex w-full items-center justify-center gap-1.5 border-b border-border py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
          <Plus size={13} /> Ajouter une phase
        </button>

        <div className="bg-muted/30"><Block title="Bilan de la séance" bare><AutoTextarea value={p.review} onChange={(v) => set({ review: v })} minRows={4} className={cell} label="Bilan" /></Block></div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-4"><Attachments ownerType="prep" ownerId={prep.id} /></div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-2 text-xs font-medium text-muted-foreground">Dans le cahier journal</div>
          {usages.length === 0 ? (
            <p className="text-xs text-muted-foreground/80">Pas encore utilisée. Dans le cahier journal, menu ⋯ d'une séance › « Créer la fiche de préparation » relie automatiquement.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {usages.map((u) => (
                <button key={u.date + u.done} onClick={onOpenJournal}
                  className={cn("rounded-full border px-2 py-0.5 text-xs", u.done === 1 ? "border-transparent bg-accent text-accent-foreground" : u.done === 2 ? "border-destructive/30 text-destructive" : "border-border text-muted-foreground")}>
                  {fromDateKey(u.date).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}
                  {u.done === 1 ? " · faite" : u.done === 2 ? " · non faite" : ""}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <PrepPrint prep={p} sequence={seq} domainName={dom?.name} domainColor={dom?.color} />
    </div>
  );
}

function Block({ title, children, bare }: { title: string; children: React.ReactNode; bare?: boolean }) {
  return (
    <div className={cn("px-3 pt-2", !bare && "border-b border-border")}>
      <div className="text-xs font-semibold text-foreground">{title} :</div>
      <div className="-mx-1 pb-1">{children}</div>
    </div>
  );
}

/** Printable fiche — same layout as the paper template (A4 landscape). */
export function PrepPrint({ prep, sequence, domainName, domainColor }: { prep: Prep; sequence?: Sequence; domainName?: string; domainColor?: string }) {
  const b = "1px solid #444";
  const th: React.CSSProperties = { border: b, background: "#e8e8e8", padding: "4px 6px", fontWeight: 600, textAlign: "center" };
  const td: React.CSSProperties = { border: b, padding: "4px 6px", verticalAlign: "top", whiteSpace: "pre-wrap" };
  const rows = prep.phases.length ? prep.phases : Array.from({ length: 6 }, () => EMPTY_PHASE);
  return createPortal(
    <div className="print-root print-landscape" style={{ fontFamily: '"Onest Variable", system-ui, sans-serif', fontSize: 10, color: "#111" }}>
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <span style={{ display: "inline-block", border: "1.5px solid #111", borderRadius: 4, padding: "3px 14px", fontWeight: 600, fontSize: 13 }}>Fiche de préparation de séance</span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <colgroup><col style={{ width: "12%" }} /><col style={{ width: "16%" }} /><col style={{ width: "15%" }} /><col style={{ width: "37%" }} /><col style={{ width: "20%" }} /></colgroup>
        <tbody>
          <tr>
            <td style={{ ...th, textAlign: "left" }}>Séquence : <span style={{ fontWeight: 400 }}>{sequence?.title ?? ""}</span></td>
            <td style={{ ...th }} colSpan={3}>{prep.title}{domainName ? <span style={{ fontWeight: 400, color: domainColor }}> · {domainName}</span> : null}</td>
            <td style={{ ...th, textAlign: "left" }}>
              Séance : {prep.number ?? "…"} / {sequence?.nb_sessions ?? "…"}<br />Durée : {prep.duration_min ? `${prep.duration_min} min` : ""}
            </td>
          </tr>
          <tr><td style={td} colSpan={5}><b>Objectif de la séance :</b> {prep.objective}</td></tr>
          <tr><td style={td} colSpan={5}><b>Compétences travaillées :</b> {prep.skills}</td></tr>
          <tr><td style={td} colSpan={5}><b>Matériel :</b> {prep.materials}<br /><b>Organisation :</b> {prep.organisation}</td></tr>
          <tr>
            <td style={th}>Phase</td><td style={th}>Durée et organisation</td><td style={th}>Matériel</td>
            <td style={th}>Déroulement + consignes</td><td style={th}>Activité des élèves et différenciation</td>
          </tr>
          {rows.map((ph, i) => (
            <tr key={i} className="print-break-avoid">
              <td style={td}>{ph.phase}</td><td style={td}>{ph.duration}</td><td style={td}>{ph.materials}</td>
              <td style={td}>{ph.progression}</td><td style={td}>{ph.students}</td>
            </tr>
          ))}
          <tr><td style={{ ...td, background: "#f2f2f2", height: 70 }} colSpan={5}><b><u>Bilan de la séance</u> :</b> {prep.review}</td></tr>
        </tbody>
      </table>
    </div>,
    document.body
  );
}

