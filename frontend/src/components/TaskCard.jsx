import { fmtDate } from "../App";
import { tr, trVal } from "../i18n";

const PRIO_COLORS   = { low:"#10b981", medium:"#3b82f6", high:"#f59e0b", critical:"#ef4444" };
const STATUS_COLORS = { new:"#64748b", open:"#3b82f6", in_progress:"#f59e0b", done:"#10b981" };

function isOverdue(due_date, status) {
  if (!due_date || status === "done") return false;
  return new Date(due_date) < new Date(new Date().toDateString());
}

export default function TaskCard({ task, onClick }) {
  const pc      = PRIO_COLORS[task.priority]  || "#3b82f6";
  const sc      = STATUS_COLORS[task.status]  || "#64748b";
  const overdue = isOverdue(task.due_date, task.status);

  return (
    <div onClick={onClick} style={{
      background:   "var(--bg-surface)",
      border:       `1px solid ${overdue ? "rgba(239,68,68,0.4)" : "var(--border)"}`,
      borderInlineStart:   `3px solid ${pc}`,
      borderRadius: "var(--radius)",
      padding:      "10px 12px",
      cursor:       "pointer",
      transition:   "transform 0.1s, box-shadow 0.1s, border-color 0.1s",
    }}
      onMouseEnter={e => {
        e.currentTarget.style.transform     = "translateY(-1px)";
        e.currentTarget.style.boxShadow     = "0 4px 16px rgba(0,0,0,0.2)";
        e.currentTarget.style.borderTopColor = "var(--accent)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform     = "";
        e.currentTarget.style.boxShadow     = "";
        e.currentTarget.style.borderTopColor = overdue ? "rgba(239,68,68,0.4)" : "var(--border)";
      }}
    >
      {/* Title row */}
      <div style={{ fontSize:13, fontWeight:500, marginBottom:6, lineHeight:1.4, color:"var(--text-primary)" }}>
        {task.title}
        {task.is_collaborator && (
          <span style={{ marginInlineStart:6, fontSize:10, fontWeight:600, padding:"1px 6px",
                         borderRadius:99, background:"var(--accent-soft)", color:"var(--accent)" }}>
            {tr("Collaborating")}
          </span>
        )}
      </div>

      {/* Description — rendered as HTML (bold/italic/lists), clamped to 2
          lines. Stripped-tag preview would lose the formatting the field
          is for; the clamp keeps a card-sized excerpt regardless. */}
      {task.description && (
        <div
          style={{ fontSize:11, color:"var(--text-muted)", marginBottom:8, overflow:"hidden", textOverflow:"ellipsis", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}
          dangerouslySetInnerHTML={{ __html: task.description }}
        />
      )}

      {/* Badges row */}
      <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
        <span style={{ fontSize:10, fontWeight:700, padding:"1px 6px", borderRadius:3, background:`${sc}20`, color:sc }}>
          {trVal("status", task.status, task.status.replace("_"," ")).toUpperCase()}
        </span>
        <span style={{ fontSize:10, fontWeight:700, padding:"1px 6px", borderRadius:3, background:`${pc}15`, color:pc }}>
          {trVal("prio", task.priority).toUpperCase()}
        </span>
        {/* Subtask count */}
        {task.subtask_count > 0 && (
          <span style={{ fontSize:10, fontWeight:600, padding:"1px 6px", borderRadius:3, background:"var(--bg-elevated)", color:"var(--text-muted)" }}>
            ☰ {task.subtask_done||0}/{task.subtask_count}
          </span>
        )}
        {/* Assignee avatar */}
        {task.assignee_name && (
          <div style={{ marginInlineStart:"auto", display:"flex", alignItems:"center", gap:4 }}>
            <div style={{
              width:20, height:20, borderRadius:"50%",
              background:`hsl(${(task.assignee_id*67)%360},50%,38%)`,
              color:"#fff", fontSize:9, fontWeight:700,
              display:"flex", alignItems:"center", justifyContent:"center",
            }}>{task.assignee_name[0].toUpperCase()}</div>
            <span style={{ fontSize:11, color:"var(--text-muted)" }}>{task.assignee_name.split(" ")[0]}</span>
          </div>
        )}
      </div>

      {/* Due date row */}
      {task.due_date && (
        <div style={{ marginTop:6, display:"flex", alignItems:"center", gap:4, fontSize:10,
          color: overdue ? "#ef4444" : "var(--text-muted)",
          fontWeight: overdue ? 600 : 400,
        }}>
          {/* Red bell for overdue, calendar for on-track */}
          {overdue ? (
            <span title={tr("Overdue!")} style={{ fontSize:12 }}>🔔</span>
          ) : (
            <span>📅</span>
          )}
          {fmtDate(task.due_date)}
          {overdue && <span style={{ marginInlineStart:2 }}>{tr("— Overdue")}</span>}
        </div>
      )}
    </div>
  );
}
