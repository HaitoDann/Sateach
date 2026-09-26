import { isTauri } from "./platform";
import { getEvents } from "./db";
import { reminderAt, fmtEventTime, EVENT_KINDS } from "./events";
import { addDays, fromDateKey, toDateKey } from "./time";
import { getNotificationsEnabled } from "./store";

// Event reminders. Checked every 30 s while Sat'each is open; each reminder
// fires once (remembered in localStorage) and only if it is less than 12 h late.

const SENT_KEY = "sateach:notified";
const MAX_LATE_MS = 12 * 3600_000;

function sentSet(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SENT_KEY) ?? "[]") as string[]); } catch { return new Set(); }
}
function saveSent(s: Set<string>) {
  try { localStorage.setItem(SENT_KEY, JSON.stringify([...s].slice(-300))); } catch { /* ignore */ }
}

export async function ensurePermission(): Promise<boolean> {
  try {
    if (isTauri()) {
      const n = await import("@tauri-apps/plugin-notification");
      if (await n.isPermissionGranted()) return true;
      return (await n.requestPermission()) === "granted";
    }
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

export async function sendNotification(title: string, body: string): Promise<void> {
  try {
    if (isTauri()) {
      const n = await import("@tauri-apps/plugin-notification");
      n.sendNotification({ title, body });
    } else if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body });
    }
  } catch (e) {
    console.error("Notification failed:", e);
  }
}

/** One pass: send every due, not-yet-sent reminder. Returns what was sent. */
export async function checkReminders(now = new Date()): Promise<string[]> {
  if (!(await getNotificationsEnabled())) return [];
  const events = await getEvents(toDateKey(addDays(now, -1)), toDateKey(addDays(now, 8)));
  const sent = sentSet();
  const out: string[] = [];
  for (const e of events) {
    const at = reminderAt(e);
    if (!at) continue;
    const key = `${e.id}@${at.getTime()}`;
    const late = now.getTime() - at.getTime();
    if (late < 0 || late > MAX_LATE_MS || sent.has(key)) continue;
    sent.add(key);
    const body = `${EVENT_KINDS[e.kind].label} · ${fmtEventTime(e)}${e.start_date !== toDateKey(now) ? ` · ${fromDateKey(e.start_date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}` : ""}`;
    await sendNotification(e.title, body);
    out.push(e.title);
  }
  saveSent(sent);
  return out;
}
