import type { ReactNode } from "react";
import { CalendarRange, NotebookPen, ChartNoAxesColumn, CalendarDays, CalendarFold, ClipboardList, Layers, Settings, Database, Moon, Sun } from "lucide-react";
import type { PageName } from "../lib/types";
import { cn, getVaultName } from "../lib/utils";
import logo from "../assets/logo.png";

// Nilo's compact icon rail: 64px wide, icons grow on hover, labels appear as
// tooltips. Sat'each only has a handful of views, so the rail is all it needs.

function RailItem({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={cn(
        "group/rail relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 ease-aqua hover:scale-[1.18] active:scale-105",
        active ? "text-brand-700 dark:text-brand-300" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {active && <span className="pointer-events-none absolute inset-1.5 -z-10 rounded-xl bg-accent" />}
      {children}
      <span
        className="pointer-events-none absolute left-[50px] top-1/2 z-50 -translate-y-1/2 translate-x-[-6px] whitespace-nowrap
                   rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background opacity-0 shadow-lg
                   transition-all duration-150 group-hover/rail:translate-x-0 group-hover/rail:opacity-100"
      >
        {label}
      </span>
    </button>
  );
}

const NAV: { name: PageName; label: string; Icon: typeof CalendarRange }[] = [
  { name: "timetable", label: "Emploi du temps", Icon: CalendarRange },
  { name: "journal", label: "Cahier journal", Icon: NotebookPen },
  { name: "calendar", label: "Calendrier", Icon: CalendarDays },
  { name: "year", label: "Programmation", Icon: CalendarFold },
  { name: "sequences", label: "Séquences", Icon: Layers },
  { name: "preps", label: "Fiches de préparation", Icon: ClipboardList },
  { name: "volumes", label: "Volume horaire", Icon: ChartNoAxesColumn },
];

interface Props {
  page: PageName;
  vaultPath: string;
  theme: "light" | "dark";
  onNavigate: (p: PageName) => void;
  onToggleTheme: () => void;
  onChangeVault: () => void;
}

export default function Sidebar({ page, vaultPath, theme, onNavigate, onToggleTheme, onChangeVault }: Props) {
  return (
    <nav className="no-print relative z-30 flex w-[64px] shrink-0 flex-col items-center gap-1 py-3">
      <button
        onClick={() => onNavigate("timetable")}
        className="mb-2 flex h-9 w-9 items-center justify-center transition-transform duration-200 hover:scale-110"
        title="Sat'each"
      >
        <img src={logo} alt="Sat'each" className="h-9 w-9 object-contain" />
      </button>

      {NAV.map(({ name, label, Icon }) => (
        <RailItem key={name} label={label} active={page === name} onClick={() => onNavigate(name)}>
          <Icon size={20} strokeWidth={2} />
        </RailItem>
      ))}

      <div className="mt-auto flex flex-col items-center gap-1 pt-2">
        <RailItem label={theme === "dark" ? "Thème clair" : "Thème sombre"} onClick={onToggleTheme}>
          {theme === "dark" ? <Sun size={19} strokeWidth={2} /> : <Moon size={19} strokeWidth={2} />}
        </RailItem>
        <RailItem label="Réglages" active={page === "settings"} onClick={() => onNavigate("settings")}>
          <Settings size={19} strokeWidth={2} />
        </RailItem>
        <RailItem label={`Changer de vault (${getVaultName(vaultPath)})`} onClick={onChangeVault}>
          <Database size={18} strokeWidth={2} />
        </RailItem>
      </div>
    </nav>
  );
}
