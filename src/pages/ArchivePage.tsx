import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileText, FolderOpen, Library, Paperclip, Plus, Search, Trash2, X } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Textarea } from "../components/ui/Textarea";
import { useVault } from "../context/VaultContext";
import { addArchiveFile, deleteArchiveFile, deleteArchiveItem, getArchiveFiles, getArchiveItems, saveArchiveItem } from "../lib/db";
import { isTauri } from "../lib/platform";
import type { ArchiveFile, ArchiveItem } from "../lib/types";
import { cn, withAlpha } from "../lib/utils";

type Filter = "all" | "none" | string;
type Draft = Omit<ArchiveItem, "id" | "created_at" | "updated_at"> & { id?: string };

function joinPath(vault: string, rel: string) {
  const sep = vault.includes("\\") ? "\\" : "/";
  return `${vault.replace(/[\\/]+$/, "")}${sep}${rel.split("/").join(sep)}`;
}

async function openFile(vaultPath: string, rel: string) {
  const { openPath } = await import("@tauri-apps/plugin-opener");
  await openPath(joinPath(vaultPath, rel));
}

export default function ArchivePage() {
  const { vaultPath, domains, domainById, toast, confirm } = useVault();
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [files, setFiles] = useState<ArchiveFile[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Draft | null>(null);

  const load = useCallback(async () => {
    const [i, f] = await Promise.all([getArchiveItems(), getArchiveFiles()]);
    setItems(i);
    setFiles(f);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filesByItem = useMemo(() => {
    const m = new Map<string, ArchiveFile[]>();
    for (const f of files) m.set(f.item_id, [...(m.get(f.item_id) ?? []), f]);
    return m;
  }, [files]);

  const q = query.trim().toLowerCase();
  const visible = items.filter((it) => {
    if (filter === "none" ? it.domain_id !== null && domainById.has(it.domain_id) : filter !== "all" && it.domain_id !== filter) return false;
    if (!q) return true;
    return [it.title, it.folder, it.level, it.objectives, it.progression, it.materials, it.notes].some((t) => t.toLowerCase().includes(q));
  });

  // Group: domain → folder (séquence) → courses.
  const groups = useMemo(() => {
    const byFolder = new Map<string, ArchiveItem[]>();
    for (const it of visible) {
      const dom = it.domain_id ? domainById.get(it.domain_id)?.name : undefined;
      const key = `${filter === "all" ? `${dom ?? "Sans domaine"} › ` : ""}${it.folder || "Sans séquence"}`;
      byFolder.set(key, [...(byFolder.get(key) ?? []), it]);
    }
    return [...byFolder.entries()].sort(([a], [b]) => a.localeCompare(b, "fr"));
  }, [visible, filter, domainById]);

  const countFor = (f: Filter) =>
    f === "all" ? items.length : f === "none" ? items.filter((i) => !i.domain_id || !domainById.has(i.domain_id)).length : items.filter((i) => i.domain_id === f).length;

  function newItem() {
    setEditing({
      domain_id: filter !== "all" && filter !== "none" ? filter : domains[0]?.id ?? null,
      folder: "", title: "", level: "", objectives: "", progression: "", materials: "", notes: "",
    });
  }

  async function remove(it: Draft) {
    if (!it.id) { setEditing(null); return; }
    const ok = await confirm({
      title: "Supprimer ce cours ?",
      message: `« ${it.title} » et ses fichiers joints (copiés dans le vault) seront supprimés.`,
      confirmLabel: "Supprimer",
      destructive: true,
    });
    if (!ok) return;
    const removed = await deleteArchiveItem(it.id);
    if (isTauri()) for (const f of removed) await invoke("remove_archive_file", { vaultPath, relPath: f.rel_path }).catch(() => {});
    setEditing(null);
    await load();
    toast("Cours supprimé");
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Mes cours" subtitle={`${items.length} cours archivé${items.length > 1 ? "s" : ""}`}>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un cours…"
            className="h-8 w-56 rounded-md border border-border bg-muted/40 pl-8 pr-2.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <Button size="sm" className="gap-1.5" onClick={newItem}>
          <Plus size={15} /> Nouveau cours
        </Button>
      </PageHeader>

      <div className="flex min-h-0 flex-1">
        {/* Domains */}
        <nav className="w-60 shrink-0 space-y-0.5 overflow-y-auto border-r border-border px-3 py-4">
          <FilterItem active={filter === "all"} onClick={() => setFilter("all")} label="Tous les cours" count={countFor("all")} icon={<Library size={14} />} />
          <div className="my-2 h-px bg-border" />
          {domains.map((d) => (
            <FilterItem key={d.id} active={filter === d.id} onClick={() => setFilter(d.id)} label={d.name} count={countFor(d.id)}
              icon={<span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.color }} />} />
          ))}
          {countFor("none") > 0 && (
            <FilterItem active={filter === "none"} onClick={() => setFilter("none")} label="Sans domaine" count={countFor("none")}
              icon={<span className="h-2.5 w-2.5 rounded-full border border-muted-foreground/60" />} />
          )}
        </nav>

        {/* Courses */}
        <div className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
          {visible.length === 0 ? (
            <div className="mx-auto mt-16 max-w-sm text-center">
              <Library size={28} className="mx-auto mb-3 text-brand-600" />
              <p className="text-sm text-foreground">{q ? "Aucun cours ne correspond à la recherche." : "Aucun cours archivé ici pour l'instant."}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Créez un cours, ou archivez une séance détaillée depuis le cahier journal (icône d'archive sur la séance).
              </p>
              {!q && <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={newItem}><Plus size={14} /> Nouveau cours</Button>}
            </div>
          ) : (
            <div className="space-y-6">
              {groups.map(([group, list]) => (
                <section key={group}>
                  <h2 className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <FolderOpen size={13} /> {group} <span className="text-muted-foreground/60">· {list.length}</span>
                  </h2>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">
                    {list.map((it, i) => {
                      const dom = it.domain_id ? domainById.get(it.domain_id) : undefined;
                      const nFiles = filesByItem.get(it.id)?.length ?? 0;
                      const snippet = it.objectives || it.progression || it.notes;
                      return (
                        <button
                          key={it.id}
                          onClick={() => setEditing(it)}
                          className="flex flex-col rounded-xl border border-border bg-card p-3.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md animate-item-in"
                          style={{ animationDelay: `${i * 25}ms`, borderTop: `3px solid ${dom?.color ?? "var(--border)"}` }}
                        >
                          <div className="flex items-start gap-2">
                            <span className="line-clamp-2 flex-1 font-medium text-foreground">{it.title}</span>
                            {it.level && <span className="shrink-0 rounded-full bg-muted px-2 py-px text-[11px] text-muted-foreground">{it.level}</span>}
                          </div>
                          {snippet && <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">{snippet}</p>}
                          <div className="mt-auto flex items-center gap-2 pt-3 text-[11px] text-muted-foreground">
                            {dom && (
                              <span className="rounded-full px-2 py-px font-medium text-foreground/80" style={{ backgroundColor: withAlpha(dom.color, 0.14) }}>{dom.name}</span>
                            )}
                            {nFiles > 0 && <span className="flex items-center gap-1"><Paperclip size={11} /> {nFiles}</span>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>

      {editing && (
        <CourseDialog
          initial={editing}
          items={items}
          files={editing.id ? filesByItem.get(editing.id) ?? [] : []}
          onChanged={load}
          onDelete={() => remove(editing)}
          onClose={() => { setEditing(null); void load(); }}
        />
      )}
    </div>
  );
}

function FilterItem({ active, onClick, label, count, icon }: { active: boolean; onClick: () => void; label: string; count: number; icon: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm transition-colors",
        active ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <span className="flex w-4 justify-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-xs tabular-nums opacity-70">{count || ""}</span>
    </button>
  );
}

function CourseDialog({ initial, items, files, onChanged, onDelete, onClose }: {
  initial: Draft; items: ArchiveItem[]; files: ArchiveFile[];
  onChanged: () => Promise<void>; onDelete: () => void; onClose: () => void;
}) {
  const { vaultPath, domains, domainById, toast } = useVault();
  const [d, setD] = useState<Draft>(initial);
  const [itemFiles, setItemFiles] = useState<ArchiveFile[]>(files);
  const set = (patch: Partial<Draft>) => setD((cur) => ({ ...cur, ...patch }));
  const folders = [...new Set(items.filter((i) => i.domain_id === d.domain_id && i.folder).map((i) => i.folder))].sort();

  async function persist(): Promise<string> {
    const id = await saveArchiveItem({ ...d, title: d.title.trim() || "Sans titre" });
    setD((cur) => ({ ...cur, id }));
    return id;
  }

  async function save() {
    if (!d.title.trim()) return;
    await persist();
    await onChanged();
    onClose();
  }

  async function addFiles() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ multiple: true, title: "Joindre des documents au cours" });
    if (!picked) return;
    const list = Array.isArray(picked) ? picked : [picked];
    const id = d.id ?? (await persist());
    const domName = d.domain_id ? domainById.get(d.domain_id)?.name ?? "Divers" : "Divers";
    try {
      for (const src of list) {
        const rel = await invoke<string>("import_archive_file", { vaultPath, source: src, folder: domName });
        const name = src.split(/[\\/]/).pop() ?? rel;
        await addArchiveFile(id, name, rel);
      }
      setItemFiles(await getArchiveFiles(id));
      await onChanged();
      toast(`${list.length} fichier${list.length > 1 ? "s" : ""} ajouté${list.length > 1 ? "s" : ""}`);
    } catch (e) {
      toast(`Import impossible : ${e}`, "error");
    }
  }

  async function removeFile(f: ArchiveFile) {
    await deleteArchiveFile(f.id);
    await invoke("remove_archive_file", { vaultPath, relPath: f.rel_path }).catch(() => {});
    setItemFiles((cur) => cur.filter((x) => x.id !== f.id));
    await onChanged();
  }

  const field = "space-y-1 text-xs font-medium text-muted-foreground";

  return (
    <Dialog
      title={initial.id ? "Cours archivé" : "Nouveau cours"}
      onClose={onClose}
      className="max-w-2xl"
      footer={
        <div className="flex w-full items-center">
          {d.id && (
            <Button variant="ghost" size="sm" onClick={onDelete} className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive">
              <Trash2 size={14} /> Supprimer
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Fermer</Button>
            <Button size="sm" onClick={save} disabled={!d.title.trim()}>Enregistrer</Button>
          </div>
        </div>
      }
    >
      <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
        <Input autoFocus value={d.title} onChange={(e) => set({ title: e.target.value })} placeholder="Titre du cours (ex. Les fractions — découverte)" aria-label="Titre" className="text-base font-medium" />
        <div className="grid grid-cols-3 gap-3">
          <label className={field}>
            Domaine
            <Select value={d.domain_id ?? ""} onChange={(e) => set({ domain_id: e.target.value || null })}>
              {domains.map((dm) => <option key={dm.id} value={dm.id}>{dm.name}</option>)}
              <option value="">Sans domaine</option>
            </Select>
          </label>
          <label className={field}>
            Séquence / thème
            <Input value={d.folder} onChange={(e) => set({ folder: e.target.value })} list="archive-folders" placeholder="Les fractions" />
            <datalist id="archive-folders">{folders.map((f) => <option key={f} value={f} />)}</datalist>
          </label>
          <label className={field}>
            Niveau
            <Input value={d.level} onChange={(e) => set({ level: e.target.value })} placeholder="CE1" list="archive-levels" />
            <datalist id="archive-levels">{["CP", "CE1", "CE2", "CM1", "CM2"].map((l) => <option key={l} value={l} />)}</datalist>
          </label>
        </div>
        <label className={cn(field, "block")}>Objectifs<Textarea value={d.objectives} onChange={(e) => set({ objectives: e.target.value })} rows={2} /></label>
        <label className={cn(field, "block")}>Déroulement<Textarea value={d.progression} onChange={(e) => set({ progression: e.target.value })} rows={5} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className={cn(field, "block")}>Matériel<Textarea value={d.materials} onChange={(e) => set({ materials: e.target.value })} rows={3} /></label>
          <label className={cn(field, "block")}>Notes / bilan<Textarea value={d.notes} onChange={(e) => set({ notes: e.target.value })} rows={3} /></label>
        </div>

        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Documents joints</span>
            {isTauri() ? (
              <Button variant="outline" size="sm" className="h-7 gap-1.5" onClick={addFiles} disabled={!d.title.trim()}>
                <Paperclip size={13} /> Ajouter des fichiers
              </Button>
            ) : (
              <span className="text-[11px] text-muted-foreground">disponible dans l'application de bureau</span>
            )}
          </div>
          {itemFiles.length === 0 ? (
            <p className="text-xs text-muted-foreground/80">Fiches, PDF, diaporamas… Ils sont copiés dans le dossier « Cours » du vault.</p>
          ) : (
            itemFiles.map((f) => (
              <div key={f.id} className="group flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted">
                <FileText size={14} className="shrink-0 text-brand-600" />
                <button onClick={() => openFile(vaultPath, f.rel_path).catch((e) => toast(`Ouverture impossible : ${e}`, "error"))} className="min-w-0 flex-1 truncate text-left text-foreground hover:underline" title={f.rel_path}>
                  {f.name}
                </button>
                <button onClick={() => removeFile(f)} className="rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100" title="Retirer">
                  <X size={13} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </Dialog>
  );
}
