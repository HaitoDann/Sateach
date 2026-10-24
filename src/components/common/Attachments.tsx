import { useCallback, useEffect, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { FileText, ImagePlus, Paperclip, X } from "lucide-react";
import { useVault } from "../../context/VaultContext";
import { addAttachment, deleteAttachment, getAttachments } from "../../lib/db";
import { isTauri } from "../../lib/platform";
import type { Attachment, AttachmentOwner } from "../../lib/types";
import { cn } from "../../lib/utils";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

export function vaultFilePath(vault: string, rel: string): string {
  const sep = vault.includes("\\") ? "\\" : "/";
  return `${vault.replace(/[\\/]+$/, "")}${sep}${rel.split("/").join(sep)}`;
}

export async function openVaultFile(vault: string, rel: string): Promise<void> {
  const { openPath } = await import("@tauri-apps/plugin-opener");
  await openPath(vaultFilePath(vault, rel));
}

export async function removeVaultFiles(vault: string, files: Attachment[]): Promise<void> {
  if (!isTauri()) return;
  for (const f of files) await invoke("remove_archive_file", { vaultPath: vault, relPath: f.rel_path }).catch(() => {});
}

const FOLDERS: Record<AttachmentOwner, string> = { entry: "Cahier journal", prep: "Fiches de préparation", sequence: "Séquences" };

interface Props {
  ownerType: AttachmentOwner;
  /** null while the owner doesn't exist yet: `ensureOwner` creates it first. */
  ownerId: string | null;
  ensureOwner?: () => Promise<string>;
  className?: string;
}

/** Images (as thumbnails) and documents attached to a séance, fiche or séquence.
 *  Files are copied into the vault so it stays self-contained. */
export default function Attachments({ ownerType, ownerId, ensureOwner, className }: Props) {
  const { vaultPath, toast } = useVault();
  const [files, setFiles] = useState<Attachment[]>([]);
  const [preview, setPreview] = useState<Attachment | null>(null);

  const load = useCallback(async () => {
    setFiles(ownerId ? await getAttachments(ownerType, ownerId) : []);
  }, [ownerType, ownerId]);
  useEffect(() => { void load(); }, [load]);

  async function add(images: boolean) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      multiple: true,
      title: images ? "Ajouter des images" : "Joindre des documents",
      filters: images ? [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"] }] : undefined,
    });
    if (!picked) return;
    const list = Array.isArray(picked) ? picked : [picked];
    try {
      const id = ownerId ?? (ensureOwner ? await ensureOwner() : null);
      if (!id) return;
      for (const src of list) {
        const rel = await invoke<string>("import_archive_file", { vaultPath, source: src, folder: FOLDERS[ownerType] });
        await addAttachment(ownerType, id, src.split(/[\\/]/).pop() ?? rel, rel);
      }
      setFiles(await getAttachments(ownerType, id));
    } catch (e) {
      toast(`Import impossible : ${e}`, "error");
    }
  }

  async function remove(f: Attachment) {
    await deleteAttachment(f.id);
    await removeVaultFiles(vaultPath, [f]);
    setFiles((cur) => cur.filter((x) => x.id !== f.id));
  }

  const images = files.filter((f) => IMAGE_EXT.test(f.name));
  const docs = files.filter((f) => !IMAGE_EXT.test(f.name));
  const btn = "flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-medium text-muted-foreground">Images et documents</span>
        {isTauri() ? (
          <>
            <button type="button" className={btn} onClick={() => add(true)}><ImagePlus size={13} /> Image</button>
            <button type="button" className={btn} onClick={() => add(false)}><Paperclip size={13} /> Document</button>
          </>
        ) : (
          <span className="text-[11px] text-muted-foreground/80">disponible dans l'application de bureau</span>
        )}
      </div>

      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((f) => (
            <div key={f.id} className="group relative">
              <button type="button" onClick={() => setPreview(f)} title={f.name}
                className="block h-20 w-28 overflow-hidden rounded-lg border border-border bg-muted">
                <img src={convertFileSrc(vaultFilePath(vaultPath, f.rel_path))} alt={f.name} className="h-full w-full object-cover" />
              </button>
              <button type="button" onClick={() => remove(f)} title="Retirer"
                className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full bg-foreground text-background shadow group-hover:flex">
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {docs.map((f) => (
        <div key={f.id} className="group flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted">
          <FileText size={14} className="shrink-0 text-brand-600" />
          <button type="button" onClick={() => openVaultFile(vaultPath, f.rel_path).catch((e) => toast(`Ouverture impossible : ${e}`, "error"))}
            className="min-w-0 flex-1 truncate text-left text-foreground hover:underline" title={f.rel_path}>
            {f.name}
          </button>
          <button type="button" onClick={() => remove(f)} className="rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100" title="Retirer">
            <X size={13} />
          </button>
        </div>
      ))}

      {preview && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-8" onClick={() => setPreview(null)}>
          <img src={convertFileSrc(vaultFilePath(vaultPath, preview.rel_path))} alt={preview.name} className="max-h-full max-w-full rounded-lg shadow-2xl" />
          <button className="absolute right-5 top-5 rounded-full bg-white/15 p-2 text-white hover:bg-white/25" onClick={() => setPreview(null)}><X size={18} /></button>
          <button className="absolute bottom-5 rounded-md bg-white/15 px-3 py-1.5 text-sm text-white hover:bg-white/25"
            onClick={(e) => { e.stopPropagation(); void openVaultFile(vaultPath, preview.rel_path); }}>
            Ouvrir avec l'application par défaut
          </button>
        </div>
      )}
    </div>
  );
}
