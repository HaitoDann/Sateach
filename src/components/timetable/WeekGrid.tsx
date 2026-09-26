import { useEffect, useMemo, useRef, useState } from "react";
import type { Domain, Slot } from "../../lib/types";
import { DAY_NAMES, fmtDuration, fmtTime, snap, weekdayIndex } from "../../lib/time";
import { useNow } from "../../lib/useNow";
import { cn, withAlpha } from "../../lib/utils";

const SNAP = 5;           // minutes
const DEFAULT_DUR = 45;   // minutes, for a simple click on the grid
const MIN_PX_PER_MIN = 0.9;

interface Laid { slot: Slot; lane: number; lanes: number; }

/** Greedy lane layout so overlapping séances sit side by side. */
export function layoutColumn(slots: Slot[]): Laid[] {
  const items = [...slots].sort((a, b) => a.start_min - b.start_min || a.end_min - b.end_min);
  const out: Laid[] = [];
  let cluster: Slot[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const laneEnds: number[] = [];
    const laneOf = new Map<Slot, number>();
    for (const s of cluster) {
      let lane = laneEnds.findIndex((end) => end <= s.start_min);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(s.end_min); } else laneEnds[lane] = s.end_min;
      laneOf.set(s, lane);
    }
    for (const s of cluster) out.push({ slot: s, lane: laneOf.get(s)!, lanes: laneEnds.length });
    cluster = [];
    clusterEnd = -1;
  };
  for (const s of items) {
    if (cluster.length && s.start_min >= clusterEnd) flush();
    cluster.push(s);
    clusterEnd = Math.max(clusterEnd, s.end_min);
  }
  if (cluster.length) flush();
  return out;
}

type DragOp =
  | { kind: "move"; id: string; offset: number; dur: number; originX: number; originY: number; moved: boolean }
  | { kind: "resize"; id: string; start: number; day: number }
  | { kind: "create"; day: number; anchor: number; originY: number; moved: boolean };

type Draft = { id: string; day: number; start: number; end: number };

interface Props {
  days: number[];
  dayStart: number;
  dayEnd: number;
  slots: Slot[];
  domainById: Map<string, Domain>;
  onCreate: (day: number, start: number, end: number) => void;
  onEdit: (slot: Slot) => void;
  onChange: (id: string, patch: Pick<Slot, "day" | "start_min" | "end_min">) => void;
  /** A domain pastille (or the "pause" one, null) dropped on the grid. */
  onDropDomain: (domainId: string | null, day: number, start: number, end: number) => void;
}

/** Set by the legend pastilles while they are dragged (dataTransfer can't be
 *  read during dragover). `undefined` = nothing being dragged. */
export const pastilleDrag: { domainId: string | null | undefined; duration: number } = { domainId: undefined, duration: 45 };

export default function WeekGrid({ days, dayStart, dayEnd, slots, domainById, onCreate, onEdit, onChange, onDropDomain }: Props) {
  const now = useNow();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const todayDay = weekdayIndex(now);
  const [dropPreview, setDropPreview] = useState<{ day: number; start: number; end: number; color?: string } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const colsRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragOp | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [bodyH, setBodyH] = useState(600);

  // Fill the available height; scroll only when the window is really small.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBodyH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const span = Math.max(60, dayEnd - dayStart);
  const ppm = Math.max(MIN_PX_PER_MIN, (bodyH - 8) / span);
  const total = span * ppm;
  const y = (min: number) => (min - dayStart) * ppm;

  const hours = useMemo(() => {
    const out: number[] = [];
    for (let m = Math.ceil(dayStart / 60) * 60; m <= dayEnd; m += 60) out.push(m);
    return out;
  }, [dayStart, dayEnd]);

  const byDay = useMemo(
    () => days.map((d) => layoutColumn(slots.filter((s) => s.day === d))),
    [days, slots]
  );

  function setDraftBoth(d: Draft | null) { draftRef.current = d; setDraft(d); }

  function minAt(clientY: number): number {
    const r = colsRef.current!.getBoundingClientRect();
    return dayStart + (clientY - r.top) / ppm;
  }
  function dayAt(clientX: number): number {
    const r = colsRef.current!.getBoundingClientRect();
    const i = Math.max(0, Math.min(days.length - 1, Math.floor(((clientX - r.left) / r.width) * days.length)));
    return days[i];
  }
  const clamp = (m: number) => Math.max(dayStart, Math.min(dayEnd, m));

  function listen() {
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function beginMove(e: React.PointerEvent, s: Slot) {
    if (e.button !== 0) return;
    e.stopPropagation();
    dragRef.current = {
      kind: "move", id: s.id, offset: s.start_min - minAt(e.clientY), dur: s.end_min - s.start_min,
      originX: e.clientX, originY: e.clientY, moved: false,
    };
    listen();
  }

  function beginResize(e: React.PointerEvent, s: Slot) {
    if (e.button !== 0) return;
    e.stopPropagation();
    dragRef.current = { kind: "resize", id: s.id, start: s.start_min, day: s.day };
    listen();
  }

  function beginCreate(e: React.PointerEvent, day: number) {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    const anchor = snap(clamp(minAt(e.clientY)), 15);
    dragRef.current = { kind: "create", day, anchor, originY: e.clientY, moved: false };
    listen();
  }

  function onMove(e: PointerEvent) {
    const op = dragRef.current;
    if (!op) return;
    if (op.kind === "move") {
      if (Math.abs(e.clientX - op.originX) > 3 || Math.abs(e.clientY - op.originY) > 3) op.moved = true;
      if (!op.moved) return;
      const start = Math.max(dayStart, Math.min(dayEnd - op.dur, snap(minAt(e.clientY) + op.offset, SNAP)));
      setDraftBoth({ id: op.id, day: dayAt(e.clientX), start, end: start + op.dur });
    } else if (op.kind === "resize") {
      const end = Math.max(op.start + SNAP, clamp(snap(minAt(e.clientY), SNAP)));
      setDraftBoth({ id: op.id, day: op.day, start: op.start, end });
    } else {
      if (Math.abs(e.clientY - op.originY) > 4) op.moved = true;
      if (!op.moved) return;
      const cur = clamp(snap(minAt(e.clientY), SNAP));
      const start = Math.min(op.anchor, cur);
      const end = Math.max(op.anchor, cur, start + SNAP);
      setDraftBoth({ id: "__new", day: op.day, start, end });
    }
  }

  function onUp() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    const op = dragRef.current;
    const d = draftRef.current;
    dragRef.current = null;
    setDraftBoth(null);
    if (!op) return;
    if (op.kind === "move") {
      if (!op.moved) {
        const s = slots.find((x) => x.id === op.id);
        if (s) onEdit(s);
      } else if (d) {
        onChange(op.id, { day: d.day, start_min: d.start, end_min: d.end });
      }
    } else if (op.kind === "resize") {
      if (d) onChange(op.id, { day: op.day, start_min: d.start, end_min: d.end });
    } else if (op.moved && d) {
      onCreate(op.day, d.start, d.end);
    } else {
      onCreate(op.day, op.anchor, Math.min(dayEnd, op.anchor + DEFAULT_DUR));
    }
  }

  function dropRange(e: React.DragEvent): { start: number; end: number } {
    const dur = pastilleDrag.duration;
    const start = Math.max(dayStart, Math.min(dayEnd - dur, snap(minAt(e.clientY) - dur / 2, SNAP)));
    return { start, end: Math.min(dayEnd, start + dur) };
  }

  function onDragOver(e: React.DragEvent, day: number) {
    if (pastilleDrag.domainId === undefined) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const r = dropRange(e);
    const color = pastilleDrag.domainId ? domainById.get(pastilleDrag.domainId)?.color : undefined;
    if (!dropPreview || dropPreview.day !== day || dropPreview.start !== r.start) setDropPreview({ day, ...r, color });
  }

  function onDrop(e: React.DragEvent, day: number) {
    if (pastilleDrag.domainId === undefined) return;
    e.preventDefault();
    const r = dropRange(e);
    setDropPreview(null);
    onDropDomain(pastilleDrag.domainId, day, r.start, r.end);
  }

  const showNow = nowMin >= dayStart && nowMin <= dayEnd && days.includes(todayDay);

  const colBorder = "border-l border-black/[0.05] dark:border-white/[0.06] first:border-l-0";

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card">
      {/* Day headers */}
      <div className="flex shrink-0 border-b border-border">
        <div className="w-14 shrink-0" />
        {days.map((d) => {
          const mins = slots.filter((s) => s.day === d && s.domain_id).reduce((a, s) => a + s.end_min - s.start_min, 0);
          return (
            <div key={d} className={cn("flex min-w-0 flex-1 items-baseline justify-center gap-2 py-2", colBorder)}>
              <span className="text-sm font-medium text-foreground">{DAY_NAMES[d]}</span>
              {mins > 0 && <span className="text-[11px] text-muted-foreground">{fmtDuration(mins)}</span>}
            </div>
          );
        })}
      </div>

      {/* Grid */}
      <div ref={bodyRef} className="relative flex-1 overflow-y-auto">
        <div className="relative flex" style={{ height: total + 16 }}>
          {/* Hour gutter */}
          <div className="relative w-14 shrink-0">
            {hours.map((m) => (
              <div
                key={m}
                className="absolute right-2 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground/70"
                style={{ top: y(m) + 4 }}
              >
                {m === dayStart ? "" : `${String(m / 60).padStart(2, "0")}h`}
              </div>
            ))}
          </div>

          {showNow && (
            <div
              className="pointer-events-none absolute left-1 z-20 -translate-y-1/2 rounded bg-primary px-1 text-[10px] font-semibold tabular-nums text-primary-foreground"
              style={{ top: y(nowMin) + 4 }}
            >
              {fmtTime(nowMin)}
            </div>
          )}
          <div ref={colsRef} className="relative mt-1 flex flex-1" style={{ height: total }}>
            {days.map((d, di) => (
              <div
                key={d}
                onPointerDown={(e) => beginCreate(e, d)}
                onDragOver={(e) => onDragOver(e, d)}
                onDragLeave={(e) => { if (e.currentTarget === e.target) setDropPreview(null); }}
                onDrop={(e) => onDrop(e, d)}
                className={cn("relative min-w-0 flex-1 cursor-crosshair", colBorder)}
              >
                {hours.map((m) => (
                  <div key={m} className="pointer-events-none absolute inset-x-0 border-t border-black/[0.06] dark:border-white/[0.06]" style={{ top: y(m) }} />
                ))}
                {hours.map((m) =>
                  m + 30 < dayEnd ? (
                    <div key={`h${m}`} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-black/[0.035] dark:border-white/[0.035]" style={{ top: y(m + 30) }} />
                  ) : null
                )}

                {byDay[di].map(({ slot, lane, lanes }) => {
                  const dr = draft && draft.id === slot.id ? draft : null;
                  if (dr && dr.day !== d) return null; // rendered in its target column
                  return (
                    <SlotCard
                      key={slot.id}
                      slot={slot}
                      domain={slot.domain_id ? domainById.get(slot.domain_id) : undefined}
                      start={dr?.start ?? slot.start_min}
                      end={dr?.end ?? slot.end_min}
                      top={y(dr?.start ?? slot.start_min)}
                      height={((dr?.end ?? slot.end_min) - (dr?.start ?? slot.start_min)) * ppm}
                      lane={dr ? 0 : lane}
                      lanes={dr ? 1 : lanes}
                      dragging={!!dr}
                      live={d === todayDay && slot.start_min <= nowMin && nowMin < slot.end_min}
                      onPointerDown={(e) => beginMove(e, slot)}
                      onResizeDown={(e) => beginResize(e, slot)}
                    />
                  );
                })}

                {/* A séance being dragged into this column from another day */}
                {draft && draft.day === d && draft.id !== "__new" && (() => {
                  const s = slots.find((x) => x.id === draft.id);
                  if (!s || s.day === d) return null;
                  return (
                    <SlotCard
                      slot={s}
                      domain={s.domain_id ? domainById.get(s.domain_id) : undefined}
                      start={draft.start} end={draft.end}
                      top={y(draft.start)} height={(draft.end - draft.start) * ppm}
                      lane={0} lanes={1} dragging
                    />
                  );
                })()}

                {dropPreview && dropPreview.day === d && (
                  <div
                    className="pointer-events-none absolute inset-x-1 z-30 rounded-lg border-2 border-dashed px-1.5 py-0.5 text-[11px] font-medium text-foreground"
                    style={{
                      top: y(dropPreview.start), height: (dropPreview.end - dropPreview.start) * ppm,
                      borderColor: dropPreview.color ?? "var(--muted-foreground)",
                      backgroundColor: dropPreview.color ? withAlpha(dropPreview.color, 0.14) : "var(--muted)",
                    }}
                  >
                    {fmtTime(dropPreview.start)} – {fmtTime(dropPreview.end)}
                  </div>
                )}

                {/* Now line: follows the day, strong on today's column */}
                {showNow && (
                  <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top: y(nowMin) }}>
                    {d === todayDay ? (
                      <>
                        <div className="h-0.5 bg-primary shadow-[0_0_6px_var(--primary)]" />
                        <div className="absolute -left-1 -top-[4px] h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-card" />
                      </>
                    ) : (
                      <div className="border-t border-dashed border-primary/40" />
                    )}
                  </div>
                )}

                {draft && draft.id === "__new" && draft.day === d && (
                  <div
                    className="pointer-events-none absolute inset-x-1 z-30 rounded-lg border-2 border-dashed border-primary bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-foreground"
                    style={{ top: y(draft.start), height: (draft.end - draft.start) * ppm }}
                  >
                    {fmtTime(draft.start)} – {fmtTime(draft.end)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SlotCard({
  slot, domain, start, end, top, height, lane, lanes, dragging, live, onPointerDown, onResizeDown,
}: {
  slot: Slot;
  domain?: Domain;
  start: number;
  end: number;
  top: number;
  height: number;
  lane: number;
  lanes: number;
  dragging?: boolean;
  live?: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  onResizeDown?: (e: React.PointerEvent) => void;
}) {
  const color = domain?.color;
  const title = slot.title.trim() || domain?.name || "Séance";
  const showDomain = !!domain && slot.title.trim() !== "" && slot.title.trim() !== domain.name;
  const compact = height < 34;
  const widthPct = 100 / lanes;

  return (
    <div
      onPointerDown={onPointerDown}
      title={`${title}${domain ? ` · ${domain.name}` : ""}\n${fmtTime(start)} – ${fmtTime(end)} (${fmtDuration(end - start)})`}
      className={cn(
        "group absolute z-10 cursor-grab select-none overflow-hidden rounded-lg px-1.5 text-[11px] leading-tight active:cursor-grabbing",
        "ring-1 ring-black/5 transition-shadow hover:shadow-md dark:ring-white/10",
        compact ? "flex items-center gap-1.5 py-0" : "py-1",
        dragging && "z-30 opacity-95 shadow-lg ring-2 ring-primary",
        live && !dragging && "shadow-md ring-2 ring-primary"
      )}
      style={{
        top: top + 1,
        height: Math.max(14, height - 2),
        left: `calc(${lane * widthPct}% + 3px)`,
        width: `calc(${widthPct}% - 6px)`,
        ...(color
          ? {
              // Tint over an opaque card so the hour lines don't show through.
              background: `linear-gradient(${withAlpha(color, 0.16)}, ${withAlpha(color, 0.16)}), var(--card)`,
              borderLeft: `3px solid ${color}`,
            }
          : {
              backgroundImage:
                "repeating-linear-gradient(135deg, var(--muted) 0 6px, color-mix(in srgb, var(--muted) 55%, var(--card)) 6px 12px)",
              borderLeft: "3px solid var(--border)",
            }),
      }}
    >
      <div className={cn("truncate font-medium", color ? "text-foreground" : "text-muted-foreground")}>{title}</div>
      {compact ? (
        <div className="truncate text-muted-foreground tabular-nums">{fmtTime(start)}</div>
      ) : (
        <>
          {showDomain && height >= 48 && <div className="truncate text-muted-foreground">{domain!.name}</div>}
          {height >= 48 && (
            <div className="truncate tabular-nums text-muted-foreground">
              {fmtTime(start)} – {fmtTime(end)}
            </div>
          )}
          {height >= 34 && height < 48 && (
            <div className="truncate tabular-nums text-muted-foreground">{fmtTime(start)} · {fmtDuration(end - start)}</div>
          )}
        </>
      )}
      {onResizeDown && (
        <div
          onPointerDown={onResizeDown}
          className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize opacity-0 transition-opacity group-hover:opacity-100"
        >
          <div className="mx-auto mt-0.5 h-0.5 w-5 rounded-full bg-foreground/30" />
        </div>
      )}
    </div>
  );
}
