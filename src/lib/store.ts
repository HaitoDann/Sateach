import { load } from "@tauri-apps/plugin-store";
import { isTauri } from "./platform";

// App-level preferences (not stored in the vault): last opened vault + theme.
// Tauri store on desktop, localStorage in the browser demo.

const STORE_FILE = "sateach-settings.json";

async function getValue<T>(key: string): Promise<T | null> {
  try {
    if (!isTauri()) {
      const raw = localStorage.getItem(`sateach:${key}`);
      return raw === null ? null : (JSON.parse(raw) as T);
    }
    const store = await load(STORE_FILE);
    return (await store.get<T>(key)) ?? null;
  } catch {
    return null;
  }
}

async function setValue(key: string, value: unknown): Promise<void> {
  try {
    if (!isTauri()) {
      if (value === null) localStorage.removeItem(`sateach:${key}`);
      else localStorage.setItem(`sateach:${key}`, JSON.stringify(value));
      return;
    }
    const store = await load(STORE_FILE);
    if (value === null) await store.delete(key);
    else await store.set(key, value);
    await store.save();
  } catch (e) {
    console.error(`Failed to save ${key}:`, e);
  }
}

export const getLastVault = () => getValue<string>("lastVault");
export const saveLastVault = (path: string) => setValue("lastVault", path);
export const clearLastVault = () => setValue("lastVault", null);

export type Theme = "light" | "dark";

export async function getTheme(): Promise<Theme> {
  return (await getValue<string>("theme")) === "dark" ? "dark" : "light";
}
export const saveTheme = (theme: Theme) => setValue("theme", theme);

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export async function getNotificationsEnabled(): Promise<boolean> {
  return (await getValue<boolean>("notifications")) !== false;
}
export const saveNotificationsEnabled = (on: boolean) => setValue("notifications", on);
