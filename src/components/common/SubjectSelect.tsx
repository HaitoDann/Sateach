import { useState } from "react";

import { useVault } from "../../context/VaultContext";
import { createSubject } from "../../lib/db";
import { Select } from "../ui/Select";
import { cn } from "../../lib/utils";

/** Pick the dossier (sous-domaine) of a fiche / séquence, or create one inline. */
export default function SubjectSelect({ domainId, value, onChange, className }: {
  domainId: string | null; value: string | null; onChange: (id: string | null) => void; className?: string;
}) {
  const { subjects, reload } = useVault();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const options = subjects.filter((s) => s.domain_id === domainId);

  async function create() {
    const n = name.trim();
    if (!n || !domainId) { setCreating(false); return; }
    const id = await createSubject(domainId, n);
    await reload();
    onChange(id);
    setCreating(false);
    setName("");
  }

  if (creating) {
    return (
      <div className={cn("flex gap-1", className)}>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void create(); if (e.key === "Escape") setCreating(false); }}
          onBlur={() => void create()}
          placeholder="Nom du dossier (ex. Grammaire)"
          className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>
    );
  }

  return (
    <Select
      value={value ?? ""}
      disabled={!domainId}
      onChange={(e) => {
        if (e.target.value === "__new") setCreating(true);
        else onChange(e.target.value || null);
      }}
      className={cn("h-7 text-xs", className)}
      aria-label="Dossier"
    >
      <option value="">Sans dossier</option>
      {options.map((s) => <option key={s.id} value={s.id}>📁 {s.name}</option>)}
      <option value="__new">+ Nouveau dossier…</option>
    </Select>
  );
}

