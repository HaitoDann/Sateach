/** True inside the Tauri desktop app; false in a plain browser (`npm run dev`),
 *  where Sat'each falls back to an in-browser demo vault. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
