import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function getVaultName(vaultPath: string): string {
  const parts = vaultPath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || vaultPath;
}

/** Hex color + alpha (0–1) → #rrggbbaa, for the soft tinted backgrounds. */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex.slice(0, 7)}${a}`;
}
