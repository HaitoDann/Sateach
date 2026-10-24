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

// ─── Interface colour ────────────────────────────────────────────────────────

export const DEFAULT_ACCENT = "#00cec8";

export const ACCENT_PRESETS: { name: string; color: string }[] = [
  { name: "Sat'each", color: "#00cec8" },
  { name: "Bleu", color: "#3b82f6" },
  { name: "Indigo", color: "#6366f1" },
  { name: "Violet", color: "#8b5cf6" },
  { name: "Rose", color: "#ec4899" },
  { name: "Framboise", color: "#e11d48" },
  { name: "Orange", color: "#f97316" },
  { name: "Soleil", color: "#f5b100" },
  { name: "Vert", color: "#22c55e" },
  { name: "Sapin", color: "#15803d" },
  { name: "Ardoise", color: "#64748b" },
];

export async function getAccent(): Promise<string> {
  const v = await getValue<string>("accent");
  return v && /^#[0-9a-f]{6}$/i.test(v) ? v : DEFAULT_ACCENT;
}
export const saveAccent = (color: string) => setValue("accent", color);

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function mixWhite(hex: string, w: number): string {
  const ch = [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - w) + 255 * w));
  return `#${ch.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Apply the interface colour; text on it is dark or white, whichever reads best. */
export function applyAccent(color: string) {
  const root = document.documentElement.style;
  root.setProperty("--brand", color);
  const onLight = (bg: string) => (luminance(bg) > 0.36 ? `color-mix(in srgb, ${bg} 22%, #0b1615)` : "#ffffff");
  root.setProperty("--on-brand", onLight(color));
  root.setProperty("--on-brand-dark", onLight(mixWhite(color, 0.15)));
}
