import { useEffect, useState, type ReactNode } from "react";
import { Database, HardDriveDownload, Plus, Trash2 } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { useVault } from "../context/VaultContext";
import { checkpointWal, createDomain, deleteDomain, saveWeekSettings, updateDomain } from "../lib/db";
import { DOMAIN_PALETTE } from "../lib/domains";
import { DAY_NAMES, fmtTime } from "../lib/time";
import { forceBackup, listBackups, type BackupInfo } from "../lib/vault";
import { isTauri } from "../lib/platform";
import type { Domain } from "../lib/types";
import { cn } from "../lib/utils";
import { getNotificationsEnabled, saveNotificationsEnabled, type Theme } from "../lib/store";
import { ensurePermission } from "../lib/notify";

const TIME_OPTIONS = Array.from({ length: 29 }, (_, i) => 6 * 60 + i * 30); // 06:00 → 20:00

interface Props {
  theme: Theme;
  onTheme: (t: Theme) => void;
  onChangeVault: () => void;
}

export default function SettingsPage({ theme, onTheme, onChangeVault }: Props) {
  const { vaultPath, week, domains, slots, reload, toast, confirm } = useVault();
  const [backups, setBackups] = useState<BackupInfo[]>([]);

  const [notifOn, setNotifOn] = useState(true);
  useEffect(() => { void listBackups(vaultPath).then(setBackups); }, [vaultPath]);
  useEffect(() => { void getNotificationsEnabled().then(setNotifOn); }, []);

  async function toggleNotif(v: "on" | "off") {
    if (v === "on" && !(await ensurePermission())) {
      toast("Les notifications sont bloquées par le système", "error");
      return;
    }
    setNotifOn(v === "on");
    await saveNotificationsEnabled(v === "on");
  }

  async function toggleDay(d: number) {
    const days = week.days.includes(d) ? week.days.filter((x) => x !== d) : [...week.days, d].sort();
    await saveWeekSettings({ ...week, days });
    await reload();
  }

  async function setBounds(dayStart: number, dayEnd: number) {
    if (dayEnd - dayStart < 60) return;
    await saveWeekSettings({ ...week, dayStart, dayEnd });
    await reload();
  }

  async function addDomain() {
    const used = new Set(domains.map((d) => d.color));
    const color = DOMAIN_PALETTE.find((c) => !used.has(c)) ?? DOMAIN_PALETTE[0];
    await createDomain("Nouveau domaine", color);
    await reload();
  }

  async function removeDomain(d: Domain) {
    const count = slots.filter((s) => s.domain_id === d.id).length;
    const ok = await confirm({
      title: `Supprimer « ${d.name} » ?`,
      message: count
        ? `${count} séance${count > 1 ? "s" : ""} de l'emploi du temps ${count > 1 ? "deviendront" : "deviendra"} « hors domaine ». Rien d'autre n'est supprimé.`
        : "Aucune séance n'utilise ce domaine.",
      confirmLabel: "Supprimer",
      destructive: true,
    });
    if (!ok) return;
    await deleteDomain(d.id);
    await reload();
  }

  async function backupNow() {
    try {
      await forceBackup(vaultPath, checkpointWal);
      setBackups(await listBackups(vaultPath));
      toast("Sauvegarde créée");
    } catch (e) {
      toast(`Sauvegarde impossible : ${e}`, "error");
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Réglages" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-8 px-6 py-6">
          <Section title="Semaine de classe" description="Les jours et la plage horaire affichés dans l'emploi du temps.">
            <Field label="Jours de classe">
              <div className="flex flex-wrap gap-1.5">
                {DAY_NAMES.slice(0, 6).map((name, d) => (
                  <button
                    key={d}
                    onClick={() => toggleDay(d)}
                    className={cn(
                      "h-8 rounded-md border px-3 text-sm transition-colors",
                      week.days.includes(d) ? "border-transparent bg-primary font-medium text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Plage horaire">
              <div className="flex items-center gap-2">
                <Select value={week.dayStart} onChange={(e) => setBounds(Number(e.target.value), week.dayEnd)} className="w-28">
                  {TIME_OPTIONS.filter((m) => m < week.dayEnd - 30).map((m) => <option key={m} value={m}>{fmtTime(m)}</option>)}
                </Select>
                <span className="text-muted-foreground">→</span>
                <Select value={week.dayEnd} onChange={(e) => setBounds(week.dayStart, Number(e.target.value))} className="w-28">
                  {TIME_OPTIONS.filter((m) => m > week.dayStart + 30).map((m) => <option key={m} value={m}>{fmtTime(m)}</option>)}
                </Select>
              </div>
            </Field>
          </Section>

          <Section title="Domaines" description="Le nom et la couleur de chaque domaine. Les séances gardent leur nom personnalisé.">
            <div className="divide-y divide-border rounded-xl border border-border bg-card">
              {domains.map((d) => <DomainRow key={d.id} domain={d} onChanged={reload} onDelete={() => removeDomain(d)} />)}
            </div>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={addDomain}>
              <Plus size={14} /> Ajouter un domaine
            </Button>
          </Section>

          <Section title="Notifications" description="Rappels des évènements du calendrier (réunions, vacances…), selon le délai choisi pour chaque évènement.">
            <Field label="Rappels">
              <SegmentedControl<"on" | "off">
                options={[{ value: "on", label: "Activés" }, { value: "off", label: "Désactivés" }]}
                value={notifOn ? "on" : "off"}
                onChange={toggleNotif}
                className="w-fit"
              />
            </Field>
          </Section>

          <Section title="Apparence">
            <Field label="Thème">
              <SegmentedControl<Theme>
                options={[{ value: "light", label: "Clair" }, { value: "dark", label: "Sombre" }]}
                value={theme}
                onChange={onTheme}
                className="w-fit"
              />
            </Field>
          </Section>

          <Section title="Vault" description="Toutes vos données sont dans ce dossier (fichier sateach.db). Placez-le dans un dossier synchronisé (OneDrive, Google Drive…) pour le retrouver sur un autre ordinateur.">
            <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <Database size={16} className="shrink-0 text-brand-600" />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={vaultPath}>
                {isTauri() ? vaultPath : "Démo dans le navigateur (données locales)"}
              </span>
              <Button variant="outline" size="sm" onClick={onChangeVault}>Changer de vault</Button>
            </div>
            {isTauri() && (
              <div className="flex items-center gap-3">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={backupNow}>
                  <HardDriveDownload size={14} /> Sauvegarder maintenant
                </Button>
                <span className="text-xs text-muted-foreground">
                  {backups.length === 0
                    ? "Aucune sauvegarde pour l'instant."
                    : `${backups.length} sauvegarde${backups.length > 1 ? "s" : ""} automatique${backups.length > 1 ? "s" : ""} · dernière le ${new Date(backups[0].timestamp_ms).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}`}
                </span>
              </div>
            )}
          </Section>

          <p className="pb-2 text-center text-xs text-muted-foreground">Sat'each {__APP_VERSION__}</p>
        </div>
      </div>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <span className="w-36 shrink-0 text-sm text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function DomainRow({ domain, onChanged, onDelete }: { domain: Domain; onChanged: () => Promise<void>; onDelete: () => void }) {
  const [name, setName] = useState(domain.name);
  const [palette, setPalette] = useState(false);
  useEffect(() => setName(domain.name), [domain.name]);

  async function commitName() {
    const n = name.trim();
    if (!n) { setName(domain.name); return; }
    if (n !== domain.name) {
      await updateDomain(domain.id, { name: n });
      await onChanged();
    }
  }

  async function pick(color: string) {
    setPalette(false);
    await updateDomain(domain.id, { color });
    await onChanged();
  }

  return (
    <div className="relative flex items-center gap-3 px-3 py-2">
      <button
        onClick={() => setPalette((v) => !v)}
        className="h-6 w-6 shrink-0 rounded-full ring-2 ring-background transition-transform hover:scale-110"
        style={{ backgroundColor: domain.color, boxShadow: `0 0 0 1px ${domain.color}` }}
        title="Changer la couleur"
      />
      {palette && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPalette(false)} />
          <div className="absolute left-2 top-full z-50 -mt-1 grid w-[180px] grid-cols-6 gap-1.5 rounded-lg border border-border bg-card p-2 shadow-xl">
            {DOMAIN_PALETTE.map((c) => (
              <button
                key={c}
                onClick={() => pick(c)}
                className={cn("h-6 w-6 rounded-full transition-transform hover:scale-110", c === domain.color && "ring-2 ring-foreground ring-offset-2 ring-offset-card")}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
        </>
      )}
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="h-8 border-transparent bg-transparent shadow-none hover:border-input focus-visible:border-input"
        aria-label="Nom du domaine"
      />
      <button onClick={onDelete} className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive" title="Supprimer le domaine">
        <Trash2 size={14} />
      </button>
    </div>
  );
}
