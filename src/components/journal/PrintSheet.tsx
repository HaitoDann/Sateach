import { createPortal } from "react-dom";
import type { DaySession, Domain } from "../../lib/types";
import { fmtDuration, fmtTime } from "../../lib/time";
import { FIELDS } from "./SessionCard";

/** The printable cahier journal page (A4). Rendered in a portal that is hidden
 *  on screen and is the only thing visible when printing (see index.css). */
export default function PrintSheet({ dateLabel, notes, sessions, domainById }: {
  dateLabel: string;
  notes: string;
  sessions: DaySession[];
  domainById: Map<string, Domain>;
}) {
  const visible = sessions.filter((s) => !s.hidden);

  return createPortal(
    <div className="print-root" style={{ fontFamily: '"Onest Variable", system-ui, sans-serif', fontSize: 11, color: "#111" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", borderBottom: "2px solid #00CEC8", paddingBottom: 6, marginBottom: 10 }}>
        <div style={{ fontSize: 18, fontWeight: 600 }}>{dateLabel}</div>
        <div style={{ fontSize: 10, color: "#555" }}>Cahier journal · Sat'each</div>
      </div>

      {notes.trim() && (
        <div className="print-break-avoid" style={{ border: "1px solid #ddd", borderRadius: 6, padding: "6px 8px", marginBottom: 10, whiteSpace: "pre-wrap" }}>
          <div style={{ fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4, color: "#555", marginBottom: 2 }}>Notes du jour</div>
          {notes}
        </div>
      )}

      {visible.map((s) => {
        const d = s.domain_id ? domainById.get(s.domain_id) : undefined;
        const title = s.title.trim() || d?.name || "Séance";
        if (!d) {
          return (
            <div key={s.key} style={{ display: "flex", gap: 8, color: "#777", fontSize: 10, padding: "2px 0 6px" }}>
              <span style={{ width: 78 }}>{fmtTime(s.start_min)} – {fmtTime(s.end_min)}</span>
              <span>{title}</span>
            </div>
          );
        }
        const filled = FIELDS.filter((f) => s[f.key].trim());
        return (
          <div key={s.key} className="print-break-avoid" style={{ display: "flex", gap: 8, borderLeft: `4px solid ${d.color}`, padding: "4px 0 4px 8px", marginBottom: 8 }}>
            <div style={{ width: 70, flexShrink: 0 }}>
              <div style={{ fontWeight: 600 }}>{fmtTime(s.start_min)}</div>
              <div style={{ color: "#666" }}>{fmtTime(s.end_min)}</div>
              <div style={{ color: "#666", fontSize: 9 }}>{fmtDuration(s.end_min - s.start_min)}</div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 12 }}>
                {title} <span style={{ fontWeight: 400, color: "#666", fontSize: 10 }}>· {d.name}</span>
              </div>
              {filled.length === 0 ? (
                <div style={{ height: 34, borderBottom: "1px dotted #bbb" }} />
              ) : (
                filled.map((f) => (
                  <div key={f.key} style={{ marginTop: 3, whiteSpace: "pre-wrap" }}>
                    <span style={{ fontWeight: 600, color: "#444" }}>{f.label} : </span>
                    {s[f.key]}
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>,
    document.body
  );
}
