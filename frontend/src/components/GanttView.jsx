import { useState, useRef, useEffect } from "react";
import { fmtDate } from "../App";

const STATUS_COLORS = {
  new:         "#64748b",
  open:        "#3b82f6",
  in_progress: "#f59e0b",
  done:        "#10b981",
};
const PRIO_COLORS = {
  low:      "#10b981",
  medium:   "#3b82f6",
  high:     "#f59e0b",
  critical: "#ef4444",
};

const DAY_MS  = 86400000;
const ROW_H   = 38;    // px per task row
const HDR_H   = 56;    // month + day header combined height
const LABEL_W = 228;   // px for frozen left column
const DAY_W   = 32;    // px per day cell

function stripTime(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d, n) { return new Date(d.getTime() + n * DAY_MS); }
function diffDays(a, b) { return Math.round((b - a) / DAY_MS); }
function toDate(str)    { return str ? new Date(str) : null; }
function formatMonth(d) {
  return d.toLocaleDateString("en-GB", { month:"short", year:"numeric" });
}

// ── Compute bar geometry for a single row ─────────────────────────────────────
function barGeom(r, minDate, maxDate) {
  const due     = r.due_date   ? stripTime(toDate(r.due_date))   : null;
  const created = r.created_at ? stripTime(new Date(r.created_at)) : null;
  const sd      = r.start_date ? stripTime(toDate(r.start_date)) : null;

  if (!due) return null;

  const start       = sd ?? (created && created < due ? created : addDays(due, -3));
  const clampStart  = start < minDate ? minDate : start;
  const clampEnd    = due   > maxDate ? maxDate : due;

  const x = diffDays(minDate, clampStart) * DAY_W;
  const w = Math.max(DAY_W, (diffDays(clampStart, clampEnd) + 1) * DAY_W);
  const dueX = diffDays(minDate, due) * DAY_W + DAY_W / 2;

  return { x, w, dueX, due };
}

export default function GanttView({ tasks, subtaskMap, dependencies = [], onEdit }) {

  // ── Flatten parent tasks + subtasks into display rows ───────────────────────
  const rows = [];
  tasks.forEach(t => {
    rows.push({ ...t, indent: 0 });
    (subtaskMap[t.id] || []).forEach(s => rows.push({ ...s, indent: 1 }));
  });

  const datedRows = rows.filter(r => r.due_date);

  // ── Timeline range ───────────────────────────────────────────────────────────
  const today  = stripTime(new Date());
  let minDate  = today;
  let maxDate  = addDays(today, 30);

  datedRows.forEach(r => {
    const due   = stripTime(toDate(r.due_date));
    const start = r.start_date
      ? stripTime(toDate(r.start_date))
      : r.created_at ? stripTime(new Date(r.created_at)) : addDays(due, -3);
    if (start < minDate) minDate = start;
    if (due   > maxDate) maxDate = due;
  });
  minDate = addDays(minDate, -3);
  maxDate = addDays(maxDate, 6);

  const totalDays  = diffDays(minDate, maxDate);
  const totalWidth = totalDays * DAY_W;

  // ── Build row index map: taskId → rowIndex ───────────────────────────────────
  const rowIndex = {};
  rows.forEach((r, i) => { rowIndex[r.id] = i; });

  // ── Build dependency arrows data ─────────────────────────────────────────────
  // dependencies = [{ task_id, depends_on_id, dep_type }]
  const arrows = [];
  dependencies.forEach(dep => {
    const fromIdx = rowIndex[dep.depends_on_id];  // blocker row
    const toIdx   = rowIndex[dep.task_id];         // blocked row
    if (fromIdx === undefined || toIdx === undefined) return;

    const fromRow = rows[fromIdx];
    const toRow   = rows[toIdx];
    const fromGeom = barGeom(fromRow, minDate, maxDate);
    const toGeom   = barGeom(toRow,   minDate, maxDate);
    if (!fromGeom || !toGeom) return;

    arrows.push({
      key:    `${dep.depends_on_id}-${dep.task_id}`,
      fromX:  fromGeom.x + fromGeom.w,          // right edge of blocker bar
      fromY:  HDR_H + fromIdx * ROW_H + ROW_H / 2,
      toX:    toGeom.x,                          // left edge of blocked bar
      toY:    HDR_H + toIdx   * ROW_H + ROW_H / 2,
      done:   fromRow.status === "done",
    });
  });

  // ── Day headers ──────────────────────────────────────────────────────────────
  const days = [];
  for (let i = 0; i < totalDays; i++) days.push(addDays(minDate, i));

  const months = [];
  days.forEach((d, i) => {
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (!months.length || months[months.length-1].key !== key)
      months.push({ key, label: formatMonth(d), startIdx: i, count: 1 });
    else months[months.length-1].count++;
  });

  const todayX = diffDays(minDate, today) * DAY_W;

  // ── Auto-scroll to today ──────────────────────────────────────────────────────
  const scrollRef = useRef(null);
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollLeft = Math.max(0, todayX - 140);
  }, [tasks.length]);

  const chartHeight = HDR_H + rows.length * ROW_H;

  // ── Empty state ───────────────────────────────────────────────────────────────
  if (datedRows.length === 0) {
    return (
      <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:12, color:"var(--text-muted)" }}>
        <div style={{ fontSize:40 }}>📅</div>
        <div style={{ fontSize:14 }}>No tasks have due dates yet.</div>
        <div style={{ fontSize:12 }}>Set a due date on tasks to see them on the Gantt chart.</div>
      </div>
    );
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>
      <div style={{ display:"flex", flex:1, overflow:"hidden" }}>

        {/* ── Frozen left label column ── */}
        <div style={{
          width: LABEL_W, flexShrink:0,
          borderRight:"1px solid var(--border)",
          background:"var(--bg-surface)", zIndex:10,
          display:"flex", flexDirection:"column",
          overflowY:"hidden",
        }}>
          {/* Header */}
          <div style={{ height: HDR_H, flexShrink:0, borderBottom:"1px solid var(--border)", background:"var(--bg-elevated)",
            display:"flex", alignItems:"center", padding:"0 14px",
            fontSize:11, fontWeight:700, color:"var(--text-muted)", textTransform:"uppercase", letterSpacing:"0.5px",
          }}>Task</div>

          {/* Row labels — scroll locked to chart */}
          <div style={{ overflowY:"hidden", flex:1 }}>
            {rows.map((r, i) => {
              const sc     = STATUS_COLORS[r.status] || "#64748b";
              const due    = r.due_date ? stripTime(toDate(r.due_date)) : null;
              const overdue = due && r.status!=="done" && due < today;
              return (
                <div key={r.id} onClick={() => onEdit(r)}
                  style={{
                    height: ROW_H, display:"flex", alignItems:"center",
                    paddingLeft: r.indent ? 26 : 10, paddingRight:8, gap:6,
                    borderBottom:"1px solid var(--border)", cursor:"pointer",
                    background: i%2===0?"var(--bg-surface)":"var(--bg-base)",
                    transition:"background 0.1s",
                  }}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--bg-hover)"}
                  onMouseLeave={e=>e.currentTarget.style.background=i%2===0?"var(--bg-surface)":"var(--bg-base)"}
                >
                  {r.indent>0 && <span style={{ fontSize:10, color:"var(--text-muted)", flexShrink:0 }}>↳</span>}
                  <span style={{ width:7, height:7, borderRadius:"50%", background:sc, flexShrink:0 }} />
                  <span style={{
                    fontSize:12, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                    fontWeight: r.indent===0?500:400,
                    color: overdue?"var(--red)": r.status==="done"?"var(--text-muted)":"var(--text-primary)",
                    textDecoration: r.status==="done"?"line-through":"none",
                  }}>{r.title}</span>
                  {overdue && <span style={{ fontSize:11, flexShrink:0 }}>🔔</span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Scrollable chart ── */}
        <div ref={scrollRef} style={{ flex:1, overflowX:"auto", overflowY:"auto", position:"relative" }}>
          <div style={{ width: totalWidth, height: chartHeight, position:"relative" }}>

            {/* Month header */}
            <div style={{ display:"flex", height:28, borderBottom:"1px solid var(--border)", background:"var(--bg-elevated)", position:"sticky", top:0, zIndex:5 }}>
              {months.map(m => (
                <div key={m.key} style={{
                  width: m.count * DAY_W, flexShrink:0,
                  fontSize:11, fontWeight:700, color:"var(--text-secondary)",
                  display:"flex", alignItems:"center", paddingLeft:8,
                  borderRight:"1px solid var(--border)", overflow:"hidden", whiteSpace:"nowrap",
                }}>{m.label}</div>
              ))}
            </div>

            {/* Day header */}
            <div style={{ display:"flex", height:28, borderBottom:"1px solid var(--border)", background:"var(--bg-elevated)", position:"sticky", top:28, zIndex:5 }}>
              {days.map((d, i) => {
                const isToday   = diffDays(today, d) === 0;
                const isWeekend = d.getDay()===0 || d.getDay()===6;
                return (
                  <div key={i} style={{
                    width: DAY_W, flexShrink:0, fontSize:9,
                    fontWeight: isToday?800:400,
                    color: isToday?"var(--accent)": isWeekend?"var(--text-muted)":"var(--text-secondary)",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    borderRight:"1px solid var(--border)",
                    background: isToday?"var(--accent-soft)": isWeekend?"var(--bg-base)":"transparent",
                  }}>{d.getDate()}</div>
                );
              })}
            </div>

            {/* Today line */}
            {todayX >= 0 && todayX <= totalWidth && (
              <div style={{
                position:"absolute", top:HDR_H, bottom:0, left: todayX + DAY_W/2,
                width:2, background:"var(--accent)", opacity:0.55, zIndex:4, pointerEvents:"none",
              }}>
                <div style={{
                  position:"absolute", top:0, left:"50%", transform:"translateX(-50%)",
                  background:"var(--accent)", color:"#fff",
                  fontSize:9, fontWeight:700, padding:"1px 5px", borderRadius:3, whiteSpace:"nowrap",
                }}>TODAY</div>
              </div>
            )}

            {/* ── SVG dependency arrows overlay ── */}
            {arrows.length > 0 && (
              <svg style={{
                position:"absolute", top:0, left:0,
                width: totalWidth, height: chartHeight,
                pointerEvents:"none", zIndex:6, overflow:"visible",
              }}>
                <defs>
                  <marker id="arrow-blocked" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L8,3 z" fill="#ef4444" />
                  </marker>
                  <marker id="arrow-done" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L8,3 z" fill="#10b981" />
                  </marker>
                </defs>
                {arrows.map(a => {
                  const color  = a.done ? "#10b981" : "#ef4444";
                  const marker = a.done ? "url(#arrow-done)" : "url(#arrow-blocked)";

                  // Elbow path: right → down/up → right → arrowhead
                  // Midpoint X between from and to
                  const midX = a.fromX + Math.max(20, (a.toX - a.fromX) * 0.5);
                  const path = `M ${a.fromX} ${a.fromY}
                                 L ${midX} ${a.fromY}
                                 L ${midX} ${a.toY}
                                 L ${a.toX - 4} ${a.toY}`;
                  return (
                    <path key={a.key} d={path}
                      fill="none"
                      stroke={color}
                      strokeWidth="1.5"
                      strokeDasharray={a.done ? "none" : "5,3"}
                      markerEnd={marker}
                      opacity="0.75"
                    />
                  );
                })}
              </svg>
            )}

            {/* Grid rows + bars */}
            {rows.map((r, i) => {
              const geom    = barGeom(r, minDate, maxDate);
              const sc      = STATUS_COLORS[r.status] || "#64748b";
              const pc      = PRIO_COLORS[r.priority]  || "#3b82f6";
              const overdue = geom?.due && r.status!=="done" && geom.due < today;
              const barColor = overdue?"#ef4444": r.status==="done"?"#10b981":pc;

              return (
                <div key={r.id} style={{
                  position:"absolute", top: HDR_H + i * ROW_H,
                  left:0, width: totalWidth, height: ROW_H,
                  borderBottom:"1px solid var(--border)",
                  background: i%2===0?"var(--bg-surface)":"var(--bg-base)",
                }}>
                  {/* Weekend shading */}
                  {days.map((d, di) =>
                    (d.getDay()===0||d.getDay()===6) ? (
                      <div key={di} style={{
                        position:"absolute", top:0, bottom:0, left:di*DAY_W, width:DAY_W,
                        background:"rgba(0,0,0,0.04)", pointerEvents:"none",
                      }} />
                    ) : null
                  )}

                  {/* Task bar */}
                  {geom && (
                    <div onClick={() => onEdit(r)}
                      title={`${r.title}${r.start_date?" | Start: "+fmtDate(r.start_date):""} | Due: ${fmtDate(r.due_date)}`}
                      style={{
                        position:"absolute", top:6, height: ROW_H-12,
                        left: geom.x, width: geom.w,
                        background: barColor,
                        opacity: r.status==="done"?0.45:0.85,
                        borderRadius:4, cursor:"pointer",
                        display:"flex", alignItems:"center", paddingLeft:6,
                        overflow:"hidden",
                        boxShadow:`0 1px 4px ${barColor}55`,
                        transition:"opacity 0.1s, transform 0.1s",
                        zIndex:2,
                      }}
                      onMouseEnter={e=>{ e.currentTarget.style.opacity="1"; e.currentTarget.style.transform="scaleY(1.08)"; }}
                      onMouseLeave={e=>{ e.currentTarget.style.opacity=r.status==="done"?"0.45":"0.85"; e.currentTarget.style.transform=""; }}
                    >
                      <span style={{ fontSize:10, fontWeight:600, color:"#fff", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                        {r.title}
                      </span>
                    </div>
                  )}

                  {/* Due date diamond */}
                  {geom && (
                    <div style={{
                      position:"absolute",
                      top:"50%", transform:"translateY(-50%) rotate(45deg)",
                      left: geom.dueX - 5,
                      width:10, height:10,
                      background: overdue?"#ef4444":sc,
                      zIndex:3, pointerEvents:"none",
                      boxShadow:"0 0 0 2px var(--bg-surface)",
                    }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Legend ── */}
      <div style={{
        flexShrink:0, padding:"7px 16px", borderTop:"1px solid var(--border)",
        background:"var(--bg-surface)",
        display:"flex", gap:20, alignItems:"center", fontSize:11, color:"var(--text-muted)", flexWrap:"wrap",
      }}>
        <span style={{ fontWeight:600, color:"var(--text-secondary)" }}>Legend:</span>
        {[
          { color:"#3b82f6", label:"Open" },
          { color:"#f59e0b", label:"In Progress" },
          { color:"#10b981", label:"Done" },
          { color:"#ef4444", label:"Overdue" },
        ].map(l => (
          <div key={l.label} style={{ display:"flex", alignItems:"center", gap:5 }}>
            <div style={{ width:14, height:8, borderRadius:2, background:l.color, opacity:0.85 }} />
            <span>{l.label}</span>
          </div>
        ))}
        <div style={{ display:"flex", alignItems:"center", gap:5 }}>
          <div style={{ width:10, height:10, background:"#64748b", transform:"rotate(45deg)" }} />
          <span>Due date</span>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:5 }}>
          <svg width="30" height="12" style={{ overflow:"visible" }}>
            <line x1="0" y1="6" x2="22" y2="6" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4,2" />
            <polygon points="20,3 20,9 28,6" fill="#ef4444" />
          </svg>
          <span>Blocked by (open)</span>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:5 }}>
          <svg width="30" height="12" style={{ overflow:"visible" }}>
            <line x1="0" y1="6" x2="22" y2="6" stroke="#10b981" strokeWidth="1.5" />
            <polygon points="20,3 20,9 28,6" fill="#10b981" />
          </svg>
          <span>Blocked by (resolved)</span>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:5 }}>
          <div style={{ width:2, height:14, background:"var(--accent)", opacity:0.6 }} />
          <span>Today</span>
        </div>
      </div>
    </div>
  );
}
