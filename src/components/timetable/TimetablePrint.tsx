import { createPortal } from "react-dom";
import { useVault } from "../../context/VaultContext";
import { computeVolumes } from "../../lib/domains";
import { DAY_NAMES, fmtDuration, fmtTime } from "../../lib/time";
import { withAlpha } from "../../lib/utils";

/** The timetable on one A4 landscape page (hidden on screen; see index.css).
 *  « Imprimer / PDF » → choose « Microsoft Print to PDF » to get a PDF. */
export default function TimetablePrint() {
  const { slots, week, domains, domainById } = useVault();
  const days = week.days;
  const span = Math.max(60, week.dayEnd - week.dayStart);
  const pct = (m: number) => ((m - week.dayStart) / span) * 100;
  const hours: number[] = [];
  for (let m = Math.ceil(week.dayStart / 60) * 60; m <= week.dayEnd; m += 60) hours.push(m);
  const volumes = computeVolumes(domains, slots, days).filter((v) => v.planned > 0);
  const total = volumes.reduce((a, v) => a + v.planned, 0);

  return createPortal(
    <div className="print-root print-landscape" style={{ fontFamily: '"Onest Variable", system-ui, sans-serif', color: "#111", fontSize: 9 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", borderBottom: "2px solid #00CEC8", paddingBottom: 4, marginBottom: 6 }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Emploi du temps</div>
        <div style={{ fontSize: 9, color: "#555" }}>{fmtDuration(total)} d'enseignement par semaine · Sat'each</div>
      </div>
      <div style={{ display: "flex" }}>
        <div style={{ width: 28 }} />
        {days.map((d) => (
          <div key={d} style={{ flex: 1, textAlign: "center", fontWeight: 600, fontSize: 10, paddingBottom: 3 }}>{DAY_NAMES[d]}</div>
        ))}
      </div>
      <div style={{ display: "flex", height: "150mm", position: "relative" }}>
        <div style={{ width: 28, position: "relative" }}>
          {hours.map((m) => (
            <div key={m} style={{ position: "absolute", top: `${pct(m)}%`, right: 4, transform: "translateY(-50%)", color: "#777", fontSize: 8 }}>
              {String(m / 60).padStart(2, "0")}h
            </div>
          ))}
        </div>
        {days.map((d) => (
          <div key={d} style={{ flex: 1, position: "relative", borderLeft: "1px solid #ddd" }}>
            {hours.map((m) => (
              <div key={m} style={{ position: "absolute", left: 0, right: 0, top: `${pct(m)}%`, borderTop: "1px solid #eee" }} />
            ))}
            {slots.filter((s) => s.day === d).map((s) => {
              const dom = s.domain_id ? domainById.get(s.domain_id) : undefined;
              const h = pct(s.end_min) - pct(s.start_min);
              return (
                <div key={s.id} style={{
                  position: "absolute", left: 2, right: 2, top: `${pct(s.start_min)}%`, height: `${h}%`, overflow: "hidden",
                  borderRadius: 3, padding: "1px 3px", boxSizing: "border-box",
                  background: dom ? `linear-gradient(${withAlpha(dom.color, 0.2)}, ${withAlpha(dom.color, 0.2)}), #fff` : "#f1f1f1", borderLeft: `3px solid ${dom?.color ?? "#bbb"}`,
                }}>
                  <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.title || dom?.name || ""}</div>
                  {h > 6 && <div style={{ color: "#555", fontSize: 8 }}>{fmtTime(s.start_min)} – {fmtTime(s.end_min)}{dom && s.title && s.title !== dom.name ? ` · ${dom.name}` : ""}</div>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 8 }}>
        {volumes.map((v) => (
          <span key={v.domain.id} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: v.domain.color, display: "inline-block" }} />
            {v.domain.name} {fmtDuration(v.planned)}
          </span>
        ))}
      </div>
    </div>,
    document.body
  );
}
