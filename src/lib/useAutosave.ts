import { useEffect, useRef, useState } from "react";

/** Saves `value` `delay` ms after the last change (and when unmounting).
 *  `key` identifies the edited object: changing it resets without saving. */
export function useAutosave<T>(key: string | null, value: T, save: (v: T) => Promise<void>, delay = 700) {
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const latest = useRef(value);
  const dirty = useRef(false);
  const saveRef = useRef(save);
  saveRef.current = save;
  const first = useRef(true);

  useEffect(() => { first.current = true; dirty.current = false; setStatus("idle"); }, [key]);

  useEffect(() => {
    latest.current = value;
    if (first.current) { first.current = false; return; }
    dirty.current = true;
    setStatus("saving");
    const t = setTimeout(async () => {
      dirty.current = false;
      await saveRef.current(latest.current);
      setStatus("saved");
    }, delay);
    return () => clearTimeout(t);
  }, [value, delay]);

  // Flush on unmount / object change.
  useEffect(() => () => {
    if (dirty.current) { dirty.current = false; void saveRef.current(latest.current); }
  }, [key]);

  return status;
}
