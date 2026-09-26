import { useState } from "react";
import Sidebar from "../components/Sidebar";
import { VaultProvider, useVault } from "../context/VaultContext";
import TimetablePage from "./TimetablePage";
import JournalPage from "./JournalPage";
import VolumesPage from "./VolumesPage";
import SettingsPage from "./SettingsPage";
import type { PageName } from "../lib/types";
import type { Theme } from "../lib/store";

interface Props {
  vaultPath: string;
  theme: Theme;
  onTheme: (t: Theme) => void;
  onChangeVault: () => void;
}

function Pages({ page, setPage, theme, onTheme, onChangeVault }: Omit<Props, "vaultPath"> & { page: PageName; setPage: (p: PageName) => void }) {
  const { loaded } = useVault();
  if (!loaded) return null;
  switch (page) {
    case "timetable":
      return <TimetablePage />;
    case "journal":
      return <JournalPage onNavigate={setPage} />;
    case "volumes":
      return <VolumesPage />;
    case "settings":
      return <SettingsPage theme={theme} onTheme={onTheme} onChangeVault={onChangeVault} />;
  }
}

export default function MainApp({ vaultPath, theme, onTheme, onChangeVault }: Props) {
  const [page, setPage] = useState<PageName>(() => {
    try { return (localStorage.getItem("sateach:page") as PageName) || "timetable"; } catch { return "timetable"; }
  });

  function navigate(p: PageName) {
    setPage(p);
    try { localStorage.setItem("sateach:page", p); } catch { /* ignore */ }
  }

  return (
    <VaultProvider vaultPath={vaultPath}>
      <div className="flex h-full overflow-hidden bg-background">
        <Sidebar
          page={page}
          vaultPath={vaultPath}
          theme={theme}
          onNavigate={navigate}
          onToggleTheme={() => onTheme(theme === "dark" ? "light" : "dark")}
          onChangeVault={onChangeVault}
        />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden border-l border-border bg-background">
          <div key={page} className="h-full animate-view-enter">
            <Pages page={page} setPage={navigate} theme={theme} onTheme={onTheme} onChangeVault={onChangeVault} />
          </div>
        </main>
      </div>
    </VaultProvider>
  );
}
